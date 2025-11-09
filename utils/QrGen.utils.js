import QRCode from "qrcode";

// data → object you want encoded (like { productId, retailerId })
export const generateQRCode = async (data) => {
  try {
    const jsonData = JSON.stringify(data);
    const qrDataUrl = await QRCode.toDataURL(jsonData); // returns base64 PNG
    return qrDataUrl;
  } catch (error) {
    console.error("QR generation failed:", error);
    throw new Error("Failed to generate QR");
  }
};
