const axios = require('axios');
const db = require('./db');

async function handleComment(commentId, message, igUserId, accessToken) {
  console.log(`Replying to comment ${commentId} on ${igUserId}`);

  try {
    await axios.post(
      `https://graph.facebook.com/v24.0/${commentId}/replies`,
      { message: `Auto-reply: Thanks for your comment!` },
      { params: { access_token: accessToken } }
    );
    console.log('Reply sent!');
  } catch (err) {
    console.error('Reply failed:', err.response?.data || err.message);
  }
}

module.exports = { handleComment };
