// /home/shubh/Dairy9-New/new-bac/Dairy9-Backend/utils/Qrinfo.utils.js
import sharp from 'sharp';

export const addTextToQR = async (qrInput, productName) => {
  const text = `${productName}`;

  // Convert base64 data URL to Buffer if needed
  let qrBuffer;
  if (typeof qrInput === 'string' && qrInput.startsWith('data:image')) {
    const base64Data = qrInput.replace(/^data:image\/\w+;base64,/, '');
    qrBuffer = Buffer.from(base64Data, 'base64');
  } else {
    qrBuffer = qrInput; // already a buffer
  }

  // Create a text image using SVG
  const svgText = `
    <svg width="300" height="60">
      <rect width="100%" height="100%" fill="white"/>
      <text x="50%" y="50%" font-size="22" text-anchor="middle" fill="black" dy=".3em">${text}</text>
    </svg>
  `;
  const textBuffer = Buffer.from(svgText);

  // Combine QR and text vertically
  const combined = await sharp({
    create: {
      width: 300,
      height: 360,
      channels: 4,
      background: 'white',
    },
  })
    .composite([
      { input: qrBuffer, top: 0, left: 0 },
      { input: textBuffer, top: 300, left: 0 },
    ])
    .png()
    .toBuffer();

  return combined;
};
