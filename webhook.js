const { OpenAI } = require('openai');
const db = require('./db');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateAIReply(comment, postCaption = '') {
  const prompt = `
You are a friendly social media assistant. Reply in a natural, engaging tone.
Keep it short (1-2 sentences). Match the brand voice.

Post: "${postCaption}"
Comment: "${comment}"

Reply:
  `.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 60,
      temperature: 0.7,
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI error:', err.message);
    return null;
  }
}

async function handleComment(commentId, message, igUserId, accessToken, postId) {
  console.log(`AI replying to comment ${commentId} on post ${postId}`);

  // Get post caption for context
  let postCaption = '';
  try {
    const postRes = await require('axios').get(
      `https://graph.facebook.com/v24.0/${postId}`,
      { params: { fields: 'caption', access_token: accessToken } }
    );
    postCaption = postRes.data.caption || '';
  } catch (e) {}

  const aiReply = await generateAIReply(message, postCaption);
  const finalReply = aiReply || 'Thanks for your comment!';

  try {
    await require('axios').post(
      `https://graph.facebook.com/v24.0/${commentId}/replies`,
      { message: finalReply },
      { params: { access_token: accessToken } }
    );
    console.log('AI reply sent:', finalReply);
  } catch (err) {
    console.error('Reply failed:', err.response?.data || err.message);
  }
}

module.exports = { handleComment };