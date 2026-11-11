import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  initializeDatabase,
  getOrCreateStudentSession,
  updateStudentProgress,
  saveLKPDSubmission,
  getAllLKPDSubmissions,
  logActivity,
  pool,
} from './src/server/db.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());

// Initialize database schema tables on startup
initializeDatabase().catch((err) => {
  console.error('Database initialization warning:', err);
});

// Health check endpoint verifying Neon DB
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as current_time, current_database() as db_name');
    res.json({
      status: 'ok',
      database: 'connected (Neon PostgreSQL)',
      db_name: result.rows[0].db_name,
      server_time: result.rows[0].current_time,
    });
  } catch (error: any) {
    console.error('Database health check failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: error.message,
    });
  }
});

// GET student session progress from Neon DB
app.get('/api/session/:id', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const session = await getOrCreateStudentSession(sessionId);
    res.json(session);
  } catch (error: any) {
    console.error('Failed to get session:', error);
    res.status(500).json({ error: error.message || 'Failed to get session' });
  }
});

// POST update student session progress into Neon DB
app.post('/api/session/:id/progress', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const {
      student_name,
      student_class,
      student_number,
      school_name,
      total_score,
      badge_title,
      badge_level,
      progress_data,
      essay_answers,
    } = req.body;

    const updated = await updateStudentProgress(sessionId, {
      student_name,
      student_class,
      student_number,
      school_name,
      total_score,
      badge_title,
      badge_level,
      progress_data,
      essay_answers,
    });

    res.json({ success: true, session: updated });
  } catch (error: any) {
    console.error('Failed to update progress:', error);
    res.status(500).json({ error: error.message || 'Failed to update progress' });
  }
});

// POST submit LKPD worksheet into Neon DB
app.post('/api/lkpd/submit', async (req, res) => {
  try {
    const {
      session_id,
      student_name,
      student_class,
      student_number,
      school_name,
      total_score,
      badge_title,
      badge_level,
      essay_1,
      essay_2,
      essay_3,
      progress_summary,
    } = req.body;

    if (!student_name || !student_class) {
      return res.status(400).json({ error: 'Nama dan kelas wajib diisi' });
    }

    const submission = await saveLKPDSubmission({
      session_id: session_id || 'anonymous',
      student_name,
      student_class,
      student_number: student_number || '-',
      school_name: school_name || 'SMP Negeri 03 Batu',
      total_score: total_score ?? 0,
      badge_title: badge_title || 'Calon Detektif Sosial',
      badge_level: badge_level || 'Pemula',
      essay_1: essay_1 || '',
      essay_2: essay_2 || '',
      essay_3: essay_3 || '',
      progress_summary: progress_summary || {},
    });

    // Also log this key milestone in activity_logs
    await logActivity({
      session_id: session_id || 'anonymous',
      student_name,
      activity_type: 'lkpd_submission',
      activity_id: `submission-${submission.id}`,
      is_correct: total_score >= 70,
      details: { total_score, badge_title, badge_level },
    });

    res.json({
      success: true,
      message: 'LKPD berhasil disimpan ke database Neon!',
      submission,
    });
  } catch (error: any) {
    console.error('Failed to submit LKPD:', error);
    res.status(500).json({ error: error.message || 'Failed to submit LKPD' });
  }
});

// GET all LKPD submissions for Teacher Panel (Ibu Dewi Rossilia, S.Pd.)
app.get('/api/teacher/submissions', async (req, res) => {
  try {
    const submissions = await getAllLKPDSubmissions();
    res.json({
      success: true,
      count: submissions.length,
      submissions,
    });
  } catch (error: any) {
    console.error('Failed to fetch teacher submissions:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch submissions' });
  }
});

// POST log activity event into Neon DB
app.post('/api/activity/log', async (req, res) => {
  try {
    const { session_id, student_name, activity_type, activity_id, is_correct, details } = req.body;
    const log = await logActivity({
      session_id: session_id || 'anonymous',
      student_name: student_name || 'Murid',
      activity_type,
      activity_id,
      is_correct: !!is_correct,
      details,
    });
    res.json({ success: true, logId: log.id });
  } catch (error: any) {
    console.error('Failed to log activity:', error);
    res.status(500).json({ error: error.message || 'Failed to log activity' });
  }
});

// Setup Vite middleware in dev or static files in prod
if (!isProd) {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port} (connected to Neon PostgreSQL)`);
});
