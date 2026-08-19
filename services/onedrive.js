// OneDrive Service module (with safe fallback if MS Graph environment variables are not configured)
const isOneDriveConfigured = () => {
  return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
};

const uploadToOneDrive = async (fileBuffer, originalName) => {
  if (!isOneDriveConfigured()) {
    return { success: false, error: 'OneDrive is not configured in .env' };
  }
  try {
    // Optional MS Graph API call if configured
    return { success: false, error: 'OneDrive integration not initialized' };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

const getOneDriveDownloadUrl = async (itemId) => {
  return null;
};

const getOneDriveFileStream = async (itemId) => {
  throw new Error('OneDrive integration is disabled');
};

module.exports = {
  isOneDriveConfigured,
  uploadToOneDrive,
  getOneDriveDownloadUrl,
  getOneDriveFileStream
};
