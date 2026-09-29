ALTER TABLE submissions ADD COLUMN examiner_reading_band REAL;
ALTER TABLE submissions ADD COLUMN examiner_listening_band REAL;

ALTER TABLE submissions ADD COLUMN examiner_writing_task1_band REAL;
ALTER TABLE submissions ADD COLUMN examiner_writing_task2_band REAL;
ALTER TABLE submissions ADD COLUMN examiner_writing_band REAL;

ALTER TABLE submissions ADD COLUMN reviewed_at TEXT;
