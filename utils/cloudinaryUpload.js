// utils/cloudinaryUpload.js
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import streamifier from 'streamifier';
import cloudinaryConfig from '../config/cloudinary.js';

dotenv.config();

// Upload single file
export const uploadToCloudinary = (fileBuffer, folder = 'dairy9', resourceType = 'image') => {
  return new Promise((resolve, reject) => {
    // Validate Cloudinary config
    const config = cloudinaryConfig.config();
    if (!config.cloud_name || !config.api_key || !config.api_secret) {
      return reject(new Error('Cloudinary not properly configured. Check your environment variables.'));
    }

    const uploadStream = cloudinaryConfig.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        timeout: 30000,
      },
      (error, result) => {
        if (error) {
          console.error('❌ Cloudinary Upload Error:', error);
          reject(new Error(`Upload failed: ${error.message}`));
        } else {
          console.log('✅ Cloudinary upload successful');
          resolve(result);
        }
      }
    );

    uploadStream.on('error', (error) => {
      console.error('❌ Upload stream error:', error);
      reject(new Error('Upload stream error'));
    });

    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

// Delete file by publicId
export const deleteFromCloudinary = async (publicId) => {
  try {
    return await cloudinaryConfig.uploader.destroy(publicId);
  } catch (error) {
    throw new Error(`Error deleting image: ${error.message}`);
  }
};

// Upload multiple files
export const uploadMultipleToCloudinary = async (files, folder = 'dairy9') => {
  try {
    const uploadPromises = files.map(file => uploadToCloudinary(file.buffer, folder));
    return await Promise.all(uploadPromises);
  } catch (error) {
    throw new Error(`Error uploading multiple images: ${error.message}`);
  }
};

// Test Cloudinary connection
export const testCloudinaryConnection = async () => {
  try {
    // Ping Cloudinary API
    const result = await cloudinary.api.ping();
    console.log('✅ Cloudinary connection test passed');
    return true;
  } catch (error) {
    console.error('❌ Cloudinary connection test failed:', error.message);

    // Check configuration
    const config = cloudinary.config();
    console.log('Cloudinary Config Status:', {
      cloud_name: config.cloud_name ? '✅ Set' : '❌ Missing',
      api_key: config.api_key ? '✅ Set' : '❌ Missing',
      api_secret: config.api_secret ? '✅ Set' : '❌ Missing'
    });

    return false;
  }
};