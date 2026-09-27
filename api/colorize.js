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

    // Clean up base64
    let cleanBase64 = imageBase64;
    if (imageBase64.includes(',')) {
      cleanBase64 = imageBase64.split(',')[1];
    }

    if (!cleanBase64 || cleanBase64.length < 100) {
      return res.status(400).json({ error: '圖片數據太短或無效' });
    }

    console.log(`Processing page ${page}, image length: ${cleanBase64.length}`);

    // Upload to imgbb
    const imgbbApiKey = process.env.IMGBB_API_KEY;
    let uploadedUrl = null;

    if (imgbbApiKey) {
      console.log('Uploading to imgbb...');
      try {
        const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKey}`, {
          method: 'POST',
          body: new URLSearchParams({
            image: cleanBase64,
            expiration: '604800'
          })
        });
        const imgbbResult = await imgbbResponse.json();
        if (imgbbResult.success && imgbbResult.data && imgbbResult.data.url) {
          uploadedUrl = imgbbResult.data.url;
          console.log('Uploaded to imgbb:', uploadedUrl);
        }
      } catch (e) {
        console.log('imgbb upload failed, trying alternative...');
      }
    }

    // Try uploading to catbox.moe as fallback
    if (!uploadedUrl) {
      console.log('Uploading to catbox.moe...');
      try {
        const imageBuffer = Buffer.from(cleanBase64, 'base64');
        const formData = new FormData();
        const blob = new Blob([imageBuffer], { type: 'image/png' });
        formData.append('reqtype', 'fileurl');
        formData.append('fileToUpload', blob, 'image.png');

        const catboxResponse = await fetch('https://catbox.moe/user/api.php', {
          method: 'POST',
          body: formData
        });
        const catboxUrl = await catboxResponse.text();
        if (catboxUrl.startsWith('https://')) {
          uploadedUrl = catboxUrl;
          console.log('Uploaded to catbox:', uploadedUrl);
        }
      } catch (e) {
        console.log('catbox upload failed:', e.message);
      }
    }

    if (!uploadedUrl) {
      return res.status(500).json({ 
        success: false, 
        error: '圖片上傳失敗，請稍後再試' 
      });
    }

    console.log('Calling MiniMax API with URL:', uploadedUrl);

    // Call MiniMax with URL
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
            image_file: uploadedUrl
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
      return res.status(500).json({ 
        success: false, 
        error: 'API 返回格式錯誤' 
      });
    }

    let base64Image = null;
    
    if (result.data && result.data[0] && result.data[0].base64) {
      base64Image = result.data[0].base64;
    } else if (result.base64) {
      base64Image = result.base64;
    } else if (result.data && result.data[0] && result.data[0].url) {
      return res.status(200).json({
        success: true,
        imageUrl: result.data[0].url,
        page: page
      });
    }

    if (base64Image) {
      return res.status(200).json({
        success: true,
        imageUrl: `data:image/png;base64,${base64Image}`,
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
