import { api } from "encore.dev/api";
import { SQLDatabase } from "encore.dev/storage/sqldb";
import log from "encore.dev/log";
import busboy from "busboy";
import { v4 as uuidv4 } from "uuid";
import { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";
import { URL } from "url";

// Define the database
export const DB = new SQLDatabase("uploads", {
  migrations: "./migrations",
});

// Define types
interface UploadSession {
  id: number;
  filename: string;
  total_chunks: number;
  uploaded_chunks: number[];
  status: string;
}

interface UploadChunk {
  upload_id: number;
  chunk_number: number;
  data: Buffer;
}
// Initialize upload
export const initializeUpload = api(
  { method: "POST", path: "/uploads/init", expose: true },
  async (params: { filename: string; totalChunks: number }): Promise<{ uploadId: number }> => {
    const result = await DB.exec`
      INSERT INTO uploads (filename, total_chunks, uploaded_chunks, status)
      VALUES (${params.filename}, ${params.totalChunks}, ARRAY[]::INTEGER[], 'in_progress')
      RETURNING id
    `;
    return { uploadId: 1 };
  }
);

// Upload chunk

export const uploadChunk = api.raw(
  { method: "PUT", path: "/uploads/:uploadId/chunk", expose: true, bodyLimit: null },
  async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const uploadId = url.pathname.split('/')[2]; // Extract uploadId from the URL path
    if (!uploadId || isNaN(parseInt(uploadId))) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid upload ID" }));
      return;
    }

    const bb = busboy({ headers: req.headers });
    
    let fileProcessed = false;
    
    bb.on("file", (_, file, info) => {
      const chunks: Buffer[] = [];
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("end", async () => {
        fileProcessed = true;
        const buffer = Buffer.concat(chunks);
        const chunkNumber = parseInt(info.filename);
        if (isNaN(chunkNumber)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid chunk number" }));
          return;
        }

        try {
          await DB.exec`
            UPDATE uploads
            SET uploaded_chunks = array_append(uploaded_chunks, ${chunkNumber}),
                status = CASE
                  WHEN array_length(uploaded_chunks, 1) + 1 = total_chunks THEN 'completed'
                  ELSE 'in_progress'
                END
            WHERE id = ${parseInt(uploadId)}
          `;
          
          // Store the chunk in a separate table
          await DB.exec`
            INSERT INTO upload_chunks (upload_id, chunk_number, data)
            VALUES (${parseInt(uploadId)}, ${chunkNumber}, ${buffer})
          `;
          
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: `Chunk ${chunkNumber} uploaded` }));
        } catch (error) {
          console.error(error);
          log.error("Error uploading chunk", { error, uploadId, chunkNumber });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to upload chunk" }));
        }
      });
    });
    
    bb.on("error", (error) => {
      log.error("Busboy error", { error, uploadId });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Error processing upload" }));
    });
    
    bb.on("finish", () => {
      if (!fileProcessed) {
        log.error("No file processed", { uploadId });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No file received" }));
      }
    });
    
    req.pipe(bb);
  }
);

// Finalize upload

export const finalizeUpload = api(
  { method: "POST", path: "/uploads/:uploadId/finalize", expose: true },
  async (params: { uploadId: number }): Promise<{ message: string }> => {
    const upload = await DB.queryRow<UploadSession>`
      SELECT id, filename, status
      FROM uploads
      WHERE id = ${params.uploadId}
    `;
    console.log(upload, "here", params.uploadId)
    if (!upload) {
      throw new Error("Upload session not found");
    }

    // if (upload.status !== 'completed') {
    //   throw new Error("Not all chunks have been uploaded");
    // }

    console.log(upload)

    // Implement logic to assemble chunks into the final file
    const chunks = await DB.query<UploadChunk>`
      SELECT upload_id, chunk_number, data
      FROM upload_chunks
      WHERE upload_id = ${params.uploadId}
      ORDER BY chunk_number ASC
    `;


    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }

    const filePath = path.join(uploadDir, upload.filename);
    const writeStream = fs.createWriteStream(filePath);

    for await (const chunk of chunks) {
      const buffer = Buffer.from(chunk.data);
      writeStream.write(buffer);
    }

    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Clean up chunks from the database
    await DB.exec`
      DELETE FROM upload_chunks WHERE upload_id = ${params.uploadId}
    `;

    await DB.exec`
      UPDATE uploads
      SET status = 'finalized'
      WHERE id = ${params.uploadId}
    `;

    return { message: "Upload finalized" };
  }
);

// Check upload status
export const checkStatus = api(
  { method: "GET", path: "/uploads/:uploadId/status", expose: true },
  async (params: { uploadId: number }): Promise<UploadSession> => {
    const upload = await DB.queryRow<UploadSession>`
      SELECT * FROM uploads WHERE id = ${params.uploadId}::uuid
    `;
    
    if (!upload) {
      throw new Error("Upload session not found");
    }
    
    return upload;
  }
);

// Helper function to get the body of a request
function getBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const bodyParts: any[] = [];
    req
      .on("data", (chunk) => {
        bodyParts.push(chunk);
      })
      .on("end", () => {
        resolve(Buffer.concat(bodyParts).toString());
      });
  });
}


