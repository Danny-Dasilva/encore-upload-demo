-- migrations/20231010_create_uploads_table.sql

CREATE TABLE uploads (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  total_chunks INTEGER NOT NULL,
  uploaded_chunks INTEGER[] NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE upload_chunks (
  upload_id INTEGER REFERENCES uploads(id),
  chunk_number INTEGER NOT NULL,
  data BYTEA NOT NULL,
  PRIMARY KEY (upload_id, chunk_number)
);
