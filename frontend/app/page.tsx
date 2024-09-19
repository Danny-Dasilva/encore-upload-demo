'use client';
import React, { useState, useRef } from 'react';
import ResumableUploadSDK from './resumableUploadSDK';
const API_BASE_URL = 'http://127.0.0.1:4000';
const UploadComponent: React.FC = () => {
  const [progress, setProgress] = useState<number>(0);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sdk = new ResumableUploadSDK({
    initializeUrl: `${API_BASE_URL}/uploads/init`,
    uploadChunkUrl: `${API_BASE_URL}/uploads`,
    finalizeUrl: `${API_BASE_URL}/uploads`,
    checkStatusUrl: `${API_BASE_URL}/uploads`,
    chunkSize: 5 * 1024 * 1024, // 5MB
    concurrentUploads: 5,
  });

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert('Please select a file.');
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      // Initialize upload
      await sdk.initialize(file);
      setUploadId(sdk.uploadId);
      console.log(`Upload ID: ${sdk.uploadId}`);

      // Start upload with progress callback
      await sdk.upload((progress) => {
        setProgress(progress);
        console.log(`Progress: ${progress.toFixed(2)}%`);
      });

      alert('Upload completed successfully!');
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleResume = async () => {
    if (!uploadId) {
      alert('No upload to resume.');
      return;
    }

    setUploading(true);

    try {
      sdk.uploadId = uploadId;
      await sdk.resume();
      alert('Upload resumed successfully!');
    } catch (error) {
      console.error('Resume failed:', error);
      alert('Failed to resume upload. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Resumable File Upload</h1>
      <input
        type="file"
        ref={fileInputRef}
        className="mb-4 p-2 border rounded"
        disabled={uploading}
      />
      <div className="flex space-x-2 mb-4">
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        <button
          onClick={handleResume}
          disabled={!uploadId || uploading}
          className="px-4 py-2 bg-green-500 text-white rounded disabled:bg-gray-400"
        >
          Resume Upload
        </button>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div
          className="bg-blue-600 h-2.5 rounded-full"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      <p className="mt-2">Progress: {progress.toFixed(2)}%</p>
      {uploadId && (
        <p className="mt-2">
          Upload ID: <span className="font-mono">{uploadId}</span>
        </p>
      )}
    </div>
  );
};

export default UploadComponent;