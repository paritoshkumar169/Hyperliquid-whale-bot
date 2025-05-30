// tweet.js
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';
dotenv.config();

// Debug log to check if environment variables are loaded
console.log('Environment variables loaded:', {
  appKey: process.env.TWITTER_APP_KEY ? 'Present' : 'Missing',
  appSecret: process.env.TWITTER_APP_SECRET ? 'Present' : 'Missing',
  accessToken: process.env.TWITTER_ACCESS_TOKEN ? 'Present' : 'Missing',
  accessSecret: process.env.TWITTER_ACCESS_SECRET ? 'Present' : 'Missing',
});

const client = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

async function postTweet() {
  try {
    const tweet = await client.v2.tweet(
      '🚀 Test Tweet from Hyperliquid Whale Bot! #onchain #whales'
    );
    console.log('✅ Tweet posted:', tweet.data.id);
  } catch (err) {
    console.error('❌ Error posting tweet:', err);
  }
}

postTweet();
