// resumableUploadSDK.js

class ResumableUploadSDK {
    constructor({
      initializeUrl,
      uploadChunkUrl,
      finalizeUrl,
      checkStatusUrl,
      chunkSize = 5 * 1024 * 1024 * 1024, // 5MB
      concurrentUploads = 5,
    }) {
      this.initializeUrl = initializeUrl;
      this.uploadChunkUrl = uploadChunkUrl;
      this.finalizeUrl = finalizeUrl;
      this.checkStatusUrl = checkStatusUrl;
      this.chunkSize = chunkSize;
      this.concurrentUploads = concurrentUploads;
      this.uploadId = null;
      this.file = null;
      this.totalChunks = 0;
      this.uploadedChunks = new Set();
      this.queue = [];
      this.activeUploads = 0;
    }
  
    /**
     * Initialize the upload session.
     * @param {File} file
     */
    async initialize(file) {
      this.file = file;
      this.totalChunks = Math.ceil(file.size / this.chunkSize);
  
      const response = await fetch(this.initializeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          totalChunks: this.totalChunks,
        }),
      });
  
      const data = await response.json();
      this.uploadId = data.uploadId;
    }
  
    /**
     * Upload a single chunk.
     * @param {number} chunkNumber
     */
    async uploadChunk(chunkNumber) {
      const start = (chunkNumber - 1) * this.chunkSize;
      const end = Math.min(start + this.chunkSize, this.file.size);
      const blob = this.file.slice(start, end);
  
      const formData = new FormData();
      formData.append("chunkNumber", chunkNumber);
      formData.append("chunk", blob, chunkNumber.toString()); 
  
      const response = await fetch(`${this.uploadChunkUrl}/${this.uploadId}/chunk`, {
        method: "PUT",
        body: formData,
      });
  
      if (response.ok) {
        this.uploadedChunks.add(chunkNumber);
        this.activeUploads--;
        this.processQueue();
        // Optionally, emit progress event here
      } else {
        // Handle retry logic or emit error
        throw new Error(`Failed to upload chunk ${chunkNumber}`);
      }
    }
  
    /**
     * Start the upload process.
     */
    async upload(onProgress) {
      if (!this.uploadId) {
        throw new Error("Upload session not initialized");
      }
  
      // Initialize queue with all chunk numbers
      for (let i = 1; i <= this.totalChunks; i++) {
        if (!this.uploadedChunks.has(i)) {
          this.queue.push(i);
        }
      }
  
      return new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
        this.onProgress = onProgress;
        this.processQueue();
      });
    }
  
    /**
     * Process the upload queue with concurrency.
     */
    processQueue() {
      while (this.activeUploads < this.concurrentUploads && this.queue.length > 0) {
        const chunkNumber = this.queue.shift();
        this.activeUploads++;
        this.uploadChunk(chunkNumber)
          .then(() => {
            if (this.onProgress) {
              this.onProgress((this.uploadedChunks.size / this.totalChunks) * 100);
            }
            if (this.uploadedChunks.size === this.totalChunks) {
              this.finalizeUpload();
            }
          })
          .catch((error) => {
            this.reject(error);
          });
      }
    }
  
    /**
     * Finalize the upload after all chunks are uploaded.
     */
    async finalizeUpload() {
      try {
        const response = await fetch(`${this.finalizeUrl}/${this.uploadId}/finalize`, {
          method: "POST",
        });
  
        if (response.ok) {
          this.resolve();
        } else {
          throw new Error("Failed to finalize upload");
        }
      } catch (error) {
        this.reject(error);
      }
    }
  
    /**
     * Resume an existing upload session.
     */
    async resume() {
      const response = await fetch(`${this.checkStatusUrl}/${this.uploadId}/status`, {
        method: "GET",
      });
  
      const data = await response.json();
      this.uploadedChunks = new Set(data.uploadedChunks);
      this.totalChunks = data.totalChunks;
      this.queue = [];
  
      for (let i = 1; i <= this.totalChunks; i++) {
        if (!this.uploadedChunks.has(i)) {
          this.queue.push(i);
        }
      }
  
      this.processQueue();
    }
  }
  
  export default ResumableUploadSDK;