/**
 * Vercel Serverless Function - MiniMax PDF Colorization API
 * 
 * Flow:
 * 1. Receive base64 image from frontend
 * 2. Upload to temporary image hosting
 * 3. Send URL to MiniMax API
 * 4. Return colored result
 */

const MINIMAX_API_URL = "https://api.minimax.io/v1/image_generation";
const UPLOAD_API_URL = "https://tmpfiles.org/api/v1/upload";

const COLOR_PROMPT = `Colorize this black and white children's educational worksheet. Keep ALL black outlines and text exactly the same. Add realistic, natural colors:

- People/babies: use natural human skin tones (peach/flesh color)
- Animals: use their natural colors (frog=green, butterfly=orange+black, ant=brown/black, zebra=black+white stripes)
- Plants: grass=green, flowers=various natural colors
- Sky: light blue, clouds=white
- Water: light blue
- Bathtubs: white with light blue water
- Books: colorful covers
- Clothes: cheerful but natural colors

Make it look like a professional children's book illustration with cheerful, appropriate colors for young learners ages 3-7. Do NOT change the black outlines or text. Keep background white.`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只接受 POST 請求' });
  }

  try {
    const apiKey = process.env.MINIMAX_API_KEY;

    if (!apiKey) {
      console.error('MINIMAX_API_KEY not configured');
      return res.status(500).json({ 
        error: 'API Key 未設置。請在 Vercel 設置 MINIMAX_API_KEY 環境變量。' 
      });
    }

    let imageBase64 = null;
    let page = '1';

    if (req.body && req.body.image_base64) {
      imageBase64 = req.body.image_base64;
      page = req.body.page || '1';
    } else {
      return res.status(400).json({ error: '沒有上傳圖片' });
    }

    console.log(`Processing page ${page}, image length: ${imageBase64.length}`);

    // Clean up base64 - remove data URI prefix if present
    let cleanBase64 = imageBase64;
    if (imageBase64.includes(',')) {
      cleanBase64 = imageBase64.split(',')[1];
    }

    // Validate base64
    if (!cleanBase64 || cleanBase64.length < 100) {
      return res.status(400).json({ error: '圖片數據太短或無效' });
    }

    // Convert base64 to binary buffer
    const imageBuffer = Buffer.from(cleanBase64, 'base64');

    console.log('Uploading image to tmpfiles.org...');

    // Upload to tmpfiles.org
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('file', blob, 'image.png');

    let uploadedUrl = null;
    try {
      const uploadResponse = await fetch(UPLOAD_API_URL, {
        method: 'POST',
        body: formData
      });

      const uploadResult = await uploadResponse.json();
      console.log('Upload result:', JSON.stringify(uploadResult));

      if ((uploadResult.status === 200 || uploadResult.status === 'success') && uploadResult.data && uploadResult.data.url) {
        // Convert to direct download URL (tmpfiles.org returns a page URL)
        uploadedUrl = uploadResult.data.url.replace('/file/', '/dl/');
        console.log('Uploaded to:', uploadedUrl);
      } else {
        throw new Error('Upload failed: ' + JSON.stringify(uploadResult));
      }
    } catch (uploadError) {
      console.error('Upload error:', uploadError);
      return res.status(500).json({ 
        success: false, 
        error: '圖片上傳失敗: ' + uploadError.message 
      });
    }

    console.log('Calling MiniMax API with URL:', uploadedUrl);

    // Call MiniMax with URL instead of base64
    const miniMaxResponse = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "image-01",
        prompt: COLOR_PROMPT,
        response_format: "base64",
        aspect_ratio: "1:1",
        subject_reference: [
          {
            type: "character",
            image_file: uploadedUrl  // Use URL, not base64!
          }
        ]
      })
    });

    const responseText = await miniMaxResponse.text();

    if (!miniMaxResponse.ok) {
      console.error('MiniMax API Error:', responseText);
      return res.status(500).json({ 
        success: false, 
        error: 'MiniMax API 調用失敗: ' + responseText.substring(0, 300) 
      });
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse MiniMax response:', responseText.substring(0, 200));
      return res.status(500).json({ 
        success: false, 
        error: 'API 返回格式錯誤' 
      });
    }

    console.log('MiniMax result keys:', Object.keys(result));

    // Check for base64 image in response
    let base64Image = null;
    
    if (result.data && result.data[0] && result.data[0].base64) {
      base64Image = result.data[0].base64;
    } else if (result.base64) {
      base64Image = result.base64;
    } else if (result.data && result.data[0] && result.data[0].url) {
      // If it returns URL instead of base64
      return res.status(200).json({
        success: true,
        imageUrl: result.data[0].url,
        page: page
      });
    }

    if (base64Image) {
      const imageUrl = `data:image/png;base64,${base64Image}`;
      
      return res.status(200).json({
        success: true,
        imageUrl: imageUrl,
        page: page
      });
    } else {
      console.error('No image in response:', JSON.stringify(result).substring(0, 500));
      return res.status(500).json({ 
        success: false, 
        error: 'API 返回格式錯誤: ' + JSON.stringify(result).substring(0, 300) 
      });
    }

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ 
      error: error.message || '服務器錯誤' 
    });
  }
};
