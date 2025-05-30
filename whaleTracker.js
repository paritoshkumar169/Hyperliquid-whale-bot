// whaleTracker.js
import { connectWebSocket, fetchActivePositions, getPositionDetails, extractTradeData, processWhaleTrades } from './hyperliquid.js';
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

// Initialize Twitter client
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Store tracked whale positions
const trackedPositions = new Map();
// Store recent whale trades
const recentWhaleTrades = [];

// Handle WebSocket messages
function handleWebSocketMessage(message) {
  try {
    // Extract trade data from the message
    const trades = extractTradeData(message);
    
    // Process whale trades if any
    if (trades) {
      const whaleTrades = processWhaleTrades(trades);
      
      // Add whale trades to recent trades list
      if (whaleTrades.length > 0) {
        recentWhaleTrades.push(...whaleTrades);
        // Keep only the most recent 100 whale trades
        if (recentWhaleTrades.length > 100) {
          recentWhaleTrades.splice(0, recentWhaleTrades.length - 100);
        }
        
        // Save whale trades to file
        storeTradeData(whaleTrades);
      }
    }
  } catch (error) {
    console.error('Error processing WebSocket message:', error);
  }
}

// Scan for new whale positions
async function scanWhalePositions() {
  console.log('Scanning for whale positions...');
  const whalePositions = await fetchActivePositions();
  
  console.log(`Found ${whalePositions.length} whale positions in BTC`);
  
  for (const position of whalePositions) {
    const { wallet, asset, size, direction, notionalValue } = position;
    const positionKey = `${wallet}-${asset}`;
    
    // Check if this is a new position or an existing one
    if (!trackedPositions.has(positionKey)) {
      console.log(`New whale position detected: ${wallet} ${direction} ${Math.abs(size)} BTC ($${notionalValue.toLocaleString()})`);
      
      // Get detailed position information
      const details = await getPositionDetails(wallet, asset);
      if (details) {
        position.entryPrice = details.entryPrice;
        position.liquidationPrice = details.liquidationPrice;
        position.leverage = details.leverage;
        position.pnl = details.pnl;
        
        // Save to tracked positions
        trackedPositions.set(positionKey, position);
        
        // Log the position details
        console.log(JSON.stringify(position, null, 2));
        
        // Store the position data to a JSON file
        await storePositionData(position);
        
        // Post to Twitter if it's a significant position
        if (Math.abs(notionalValue) >= 2_000_000) { // Over $2M for tweets
          await postPositionToTwitter(position);
        }
      }
    }
  }
}

// Store position data to a JSON file
async function storePositionData(position) {
  try {
    // Create directory if it doesn't exist
    await fs.mkdir('data', { recursive: true });
    
    // Read existing data or create new array
    let positions = [];
    try {
      const data = await fs.readFile('data/whale_positions.json', 'utf8');
      positions = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, use empty array
    }
    
    // Add new position
    positions.push(position);
    
    // Write back to file
    await fs.writeFile('data/whale_positions.json', JSON.stringify(positions, null, 2));
    
    console.log(`Position data saved for ${position.wallet}`);
  } catch (error) {
    console.error('Error storing position data:', error);
  }
}

// Store trade data to a JSON file
async function storeTradeData(trades) {
  try {
    // Create directory if it doesn't exist
    await fs.mkdir('data', { recursive: true });
    
    // Read existing data or create new array
    let allTrades = [];
    try {
      const data = await fs.readFile('data/whale_trades.json', 'utf8');
      allTrades = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, use empty array
    }
    
    // Add new trades
    allTrades.push(...trades);
    
    // Keep only the most recent 1000 trades
    if (allTrades.length > 1000) {
      allTrades = allTrades.slice(-1000);
    }
    
    // Write back to file
    await fs.writeFile('data/whale_trades.json', JSON.stringify(allTrades, null, 2));
    
    console.log(`Saved ${trades.length} whale trades to file`);
  } catch (error) {
    console.error('Error storing trade data:', error);
  }
}

// Post position to Twitter
async function postPositionToTwitter(position) {
  const { wallet, asset, size, direction, notionalValue, entryPrice, leverage } = position;
  
  // Format the wallet address for display
  const shortWallet = `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  
  // Construct the tweet text
  const tweetText = `🐋 Whale Alert: ${shortWallet} just opened a ${direction} position of ${Math.abs(size).toFixed(2)} $${asset} ($${Math.round(notionalValue).toLocaleString()}) at $${entryPrice.toLocaleString()} with ${leverage}x leverage.`;
  
  try {
    // For demo purposes, just log the tweet
    console.log('Would tweet:', tweetText);
    
    // Uncomment to actually post to Twitter
    /*
    const tweet = await twitterClient.v2.tweet(tweetText);
    console.log('✅ Tweet posted:', tweet.data.id);
    */
  } catch (error) {
    console.error('Error posting to Twitter:', error);
  }
}

// Main function
async function main() {
  // Scan for current whale positions immediately
  await scanWhalePositions();
  
  // Connect to WebSocket for real-time updates
  const ws = connectWebSocket(handleWebSocketMessage);
  
  // Scan for new positions every 5 minutes
  setInterval(scanWhalePositions, 5 * 60 * 1000);
}

// Run the main function
main().catch(error => {
  console.error('Error in main function:', error);
}); 