/**
 * Vercel Serverless Function - MiniMax PDF Colorization API
 */

const MINIMAX_API_URL = "https://api.minimax.io/v1/image_generation";

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
      // It's a data URI like "data:image/png;base64,..."
      cleanBase64 = imageBase64.split(',')[1];
    }

    // Validate base64
    if (!cleanBase64 || cleanBase64.length < 100) {
      return res.status(400).json({ error: '圖片數據太短或無效' });
    }

    // Use subject_reference with RAW base64 (no data URI prefix!)
    // MiniMax accepts: URL OR raw base64 string
    const requestBody = {
      model: "image-01",
      prompt: COLOR_PROMPT,
      response_format: "base64",
      aspect_ratio: "1:1",
      subject_reference: [
        {
          type: "character",
          image_file: cleanBase64  // RAW base64 only, no data: prefix!
        }
      ]
    };

    console.log('Calling MiniMax API...');

    const miniMaxResponse = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
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

    // Check for base64 image in response
    let base64Image = null;
    
    if (result.data && result.data[0] && result.data[0].base64) {
      base64Image = result.data[0].base64;
    } else if (result.base64) {
      base64Image = result.base64;
    } else if (result.data && result.data[0] && result.data[0].url) {
      // URL response
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
