import { 
  connectWebSocket, 
  fetchActivePositions, 
  getPositionDetails, 
  extractTradeData, 
  processWhaleTrades,
  closeWebSocket,
  MONITORED_ASSETS,
  fetchRealTimePrices,
  fetchMetaAndAssetCtxs,
  fetchUserPositions,
  fetchUniverse
} from './hyperliquid.js';
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import {
  formatMobyStylePositionTweet,
  formatMobyStyleTradeTweet,
  formatMobyStylePositionUpdateTweet,
  formatMobyStylePositionClosureTweet,
  getWalletStats
} from './tweetFormats.js';

dotenv.config();

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});


const trackedPositions = new Map();
const recentWhaleTrades = [];
const marketStats = {};
let assetMetadata = null;

const assetIndices = {};

MONITORED_ASSETS.forEach(asset => {
  marketStats[asset] = {
    price: 0,
    openInterest: 0,
    lastUpdated: 0
  };
});

const processedTradeIds = new Set();
const MAX_CACHED_TRADE_IDS = 10000;


class RateLimiter {
  constructor(maxRequests, timeWindow) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = [];
    this.queue = [];
    this.processing = false;
  }

  async waitForSlot() {
    return new Promise((resolve) => {
      const now = Date.now();
      this.requests = this.requests.filter(time => now - time < this.timeWindow);
      
      if (this.requests.length < this.maxRequests) {
        this.requests.push(now);
        resolve();
      } else {

        this.queue.push(resolve);
        

        if (!this.processing) {
          this.processQueue();
        }
      }
    });
  }

  async processQueue() {
    this.processing = true;
    
    while (this.queue.length > 0) {
      const now = Date.now();
      this.requests = this.requests.filter(time => now - time < this.timeWindow);
      
      if (this.requests.length < this.maxRequests) {
        this.requests.push(now);
        const resolve = this.queue.shift();
        resolve();
      } else {
        const oldestRequest = this.requests[0];
        const waitTime = this.timeWindow - (now - oldestRequest);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    this.processing = false;
  }
}


const tweetRateLimiter = new RateLimiter(5, 60 * 1000);

async function initializeAssetIndices() {
  try {
    console.log('Initializing asset indices...');
    const universe = await fetchUniverse();
    
    if (Array.isArray(universe)) {
      universe.forEach((asset, index) => {
        if (asset && asset.name) {
          assetIndices[asset.name] = index;
          console.log(`Asset ${asset.name} has index ${index}`);
        }
      });
    }
    
    return universe;
  } catch (error) {
    console.error('Error initializing asset indices:', error);
    return null;
  }
}


function handleWebSocketMessage(message) {
  try {

    const trades = extractTradeData(message);
    
    if (trades && trades.length > 0) {
      console.log(`Received ${trades.length} trades`);
      

      const newTrades = trades.filter(trade => {
        if (!trade.tradeId || processedTradeIds.has(trade.tradeId)) {
          return false;
        }
        

        processedTradeIds.add(trade.tradeId);
        

        if (processedTradeIds.size > MAX_CACHED_TRADE_IDS) {
          const iterator = processedTradeIds.values();
          for (let i = 0; i < 1000; i++) {
            processedTradeIds.delete(iterator.next().value);
          }
        }
        
        return true;
      });
      
      console.log(`Found ${newTrades.length} new trades`);
      
      // Process new trades
      if (newTrades.length > 0) {
        const whaleTrades = processWhaleTrades(newTrades);
        console.log(`Found ${whaleTrades.length} whale trades`);
        
        // Add whale trades to recent trades list
        if (whaleTrades.length > 0) {
          recentWhaleTrades.push(...whaleTrades);
          // Keep only the most recent 100 whale trades
          if (recentWhaleTrades.length > 100) {
            recentWhaleTrades.splice(0, recentWhaleTrades.length - 100);
          }
          

          storeTradeData(whaleTrades);
          

          whaleTrades.forEach(async trade => {
            console.log(`Checking trade for Twitter: $${trade.notionalValue} (threshold: $50,000)`);
            if (trade.notionalValue >= 50_000) { // Only log trades above $50K
              await postTradeToTwitter(trade);
            }
          });
        }
        
        // Update current price if available
        if (newTrades.length > 0) {
          const asset = newTrades[0].asset;
          if (marketStats[asset]) {
            marketStats[asset].price = newTrades[0].price;
            marketStats[asset].lastUpdated = Date.now();
          }
        }
      }
    }
  } catch (error) {
    console.error('Error processing WebSocket message:', error);
  }
}

async function scanWhalePositions() {
  console.log('Scanning for whale positions...');
  
  await updateMarketStats();
  
  const whaleWallets = [];
  
  const currentPositions = [];
  
  for (const wallet of whaleWallets) {
    try {
      const userData = await fetchUserPositions(wallet);
      
      if (userData && userData.assetPositions) {
        for (const assetPosition of userData.assetPositions) {
          if (assetPosition.position) {
            const position = assetPosition.position;
            const asset = position.coin;
            
            if (!MONITORED_ASSETS.includes(asset)) {
              continue;
            }
            
            const size = parseFloat(position.szi);
            const price = marketStats[asset].price;
            
            if (!price) {
              console.warn(`No price available for ${asset}`);
              continue;
            }
            
            const notionalValue = Math.abs(size) * price;
            
            if (notionalValue >= 100_000) {
              const formattedPosition = {
                wallet,
                asset,
                size,
                direction: size > 0 ? 'LONG' : 'SHORT',
                notionalValue,
                entryPrice: parseFloat(position.entryPx),
                liquidationPrice: parseFloat(position.liquidationPx || 0),
                leverage: position.leverage ? (position.leverage.value || 0) : 0,
                pnl: parseFloat(position.unrealizedPnl || 0),
                timestamp: new Date().toISOString()
              };
              
              currentPositions.push(formattedPosition);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning wallet ${wallet}:`, error);
    }
  }
  
  try {
    const apiPositions = await fetchActivePositions();
    if (apiPositions && apiPositions.length > 0) {
      currentPositions.push(...apiPositions);
    }
  } catch (error) {
    console.error('Error fetching positions from API:', error);
  }
  
  console.log(`Found ${currentPositions.length} total whale positions`);
  
  for (const position of currentPositions) {
    const { wallet, asset, size, direction, notionalValue } = position;
    const positionKey = `${wallet}-${asset}`;
    
    if (!trackedPositions.has(positionKey)) {
      console.log(`New whale position detected: ${wallet} ${direction} ${Math.abs(size)} ${asset} ($${notionalValue.toLocaleString()})`);
      
      position.percentOfOI = calculatePercentOfOI(position);
      position.riskLevel = calculateRiskLevel(position);
      position.marketImpact = estimateMarketImpact(position);
      position.liquidationRisk = calculateLiquidationRisk(position);
      
      trackedPositions.set(positionKey, position);
      
      console.log(JSON.stringify(position, null, 2));
      
      await storePositionData(position);
      
      if (Math.abs(notionalValue) >= 1_000_000) {
        await postPositionToTwitter(position);
      }
    } else {
      const existingPosition = trackedPositions.get(positionKey);
      const sizeDelta = Math.abs(size) - Math.abs(existingPosition.size);
      
      if (Math.abs(sizeDelta) / Math.abs(existingPosition.size) > 0.1) {
        console.log(`Whale position updated: ${wallet} ${direction} ${Math.abs(size)} ${asset} (${sizeDelta > 0 ? "+" : ""}${sizeDelta.toFixed(2)})`);
        
        position.previousSize = existingPosition.size;
        position.sizeDelta = sizeDelta;
        
        position.percentOfOI = calculatePercentOfOI(position);
        position.riskLevel = calculateRiskLevel(position);
        position.marketImpact = estimateMarketImpact(position);
        position.liquidationRisk = calculateLiquidationRisk(position);
        
        trackedPositions.set(positionKey, position);
        
        console.log(JSON.stringify(position, null, 2));
        
        await storePositionData(position);
        
        if (Math.abs(notionalValue) >= 1_000_000 && Math.abs(sizeDelta) * marketStats[asset].price >= 500_000) {
          await postPositionUpdateToTwitter(position);
        }
      }
    }
  }
  
  const currentPositionKeys = new Set(currentPositions.map(p => `${p.wallet}-${p.asset}`));
  
  for (const [positionKey, position] of trackedPositions.entries()) {
    if (!currentPositionKeys.has(positionKey)) {
      console.log(`Whale position closed: ${position.wallet} ${position.direction} ${Math.abs(position.size)} ${position.asset}`);
      
      position.closed = true;
      position.closedAt = new Date().toISOString();
      
      const asset = position.asset;
      if (position.entryPrice && marketStats[asset] && marketStats[asset].price) {
        const exitPrice = marketStats[asset].price;
        const pnlAmount = position.direction === 'LONG' 
          ? (exitPrice - position.entryPrice) * Math.abs(position.size)
          : (position.entryPrice - exitPrice) * Math.abs(position.size);
        
        const pnlPercent = (pnlAmount / (position.entryPrice * Math.abs(position.size))) * 100;
        
        position.exitPrice = exitPrice;
        position.finalPnl = pnlAmount;
        position.finalPnlPercent = pnlPercent;
        
        await storeClosedPosition(position);
        
        if (Math.abs(position.notionalValue) >= 1_000_000) {
          await postPositionClosureToTwitter(position);
        }
      }
      
      trackedPositions.delete(positionKey);
    }
  }
}

// Update market statistics for all assets using Hyperliquid API
async function updateMarketStats() {
  try {
    // Get real-time prices from Hyperliquid API
    const prices = await fetchRealTimePrices();
    
    // Get metadata and asset contexts
    const metaData = await fetchMetaAndAssetCtxs();
    
    // Update market stats for each asset
    for (const asset of MONITORED_ASSETS) {
      if (!marketStats[asset]) {
        marketStats[asset] = { price: 0, openInterest: 0, lastUpdated: 0 };
      }
      
      // Update price if available
      if (prices[asset]) {
        marketStats[asset].price = prices[asset];
      }
      
      // Update open interest if available from metadata
      if (metaData && metaData.assetContexts) {
        // Find the asset context for this asset
        const assetIndex = assetIndices[asset] || -1;
        if (assetIndex >= 0 && assetIndex < metaData.assetContexts.length) {
          const assetCtx = metaData.assetContexts[assetIndex];
          if (assetCtx && assetCtx.openInterest) {
            marketStats[asset].openInterest = parseFloat(assetCtx.openInterest);
          }
        }
      }
      
      marketStats[asset].lastUpdated = Date.now();
    }
    
    // Log market stats
    console.log('Market stats updated:');
    for (const asset of MONITORED_ASSETS) {
      console.log(`- ${asset}: $${marketStats[asset].price.toLocaleString()}, OI: ${marketStats[asset].openInterest.toLocaleString()} ${asset}`);
    }
  } catch (error) {
    console.error('Error updating market stats:', error);
  }
}

// Calculate position as percentage of open interest
function calculatePercentOfOI(position) {
  const asset = position.asset;
  if (!marketStats[asset] || marketStats[asset].openInterest === 0) return 0;
  return (Math.abs(position.size) / marketStats[asset].openInterest) * 100;
}

// Calculate risk level (1-5)
function calculateRiskLevel(position) {
  // Higher leverage = higher risk
  const leverageRisk = Math.min(position.leverage / 10, 1) * 2.5; 
  
  // Larger position size relative to OI = higher risk
  const sizeRisk = Math.min(position.percentOfOI / 5, 1) * 2.5;
  
  return Math.min(Math.round(leverageRisk + sizeRisk), 5);
}

// Estimate market impact
function estimateMarketImpact(position) {
  // Simplified calculation - higher % of OI = higher impact
  return Math.min(position.percentOfOI * 2, 100);
}

// Calculate liquidation risk (0-100%)
function calculateLiquidationRisk(position) {
  const asset = position.asset;
  if (!position.liquidationPrice || !marketStats[asset] || !marketStats[asset].price) return 0;
  
  const currentPrice = marketStats[asset].price;
  const liquidationPrice = position.liquidationPrice;
  
  if (position.direction === 'LONG') {
    // For longs, liq price is below entry
    const priceDrop = ((currentPrice - liquidationPrice) / currentPrice) * 100;
    return Math.max(0, 100 - priceDrop);
  } else {
    // For shorts, liq price is above entry
    const priceRise = ((liquidationPrice - currentPrice) / currentPrice) * 100;
    return Math.max(0, 100 - priceRise);
  }
}

// Store position data to a JSON file
async function storePositionData(position) {
  try {
    // Create directory if it doesn't exist
    await fs.mkdir('data', { recursive: true });
    
    // Create asset-specific directory
    const assetDir = `data/${position.asset}`;
    await fs.mkdir(assetDir, { recursive: true });
    
    // Read existing data or create new array
    let positions = [];
    try {
      const data = await fs.readFile(`${assetDir}/whale_positions.json`, 'utf8');
      positions = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, use empty array
    }
    
    // Add new position
    positions.push(position);
    
    // Write back to file
    await fs.writeFile(`${assetDir}/whale_positions.json`, JSON.stringify(positions, null, 2));
    
    console.log(`Position data saved for ${position.wallet} on ${position.asset}`);
  } catch (error) {
    console.error('Error storing position data:', error);
  }
}

async function updateWalletStats(position) {
  try {
    const wallet = position.wallet;
    const f = `data/wallets/${wallet}.json`;
    let stats = { trades: 0, wins: 0, pnl: 0, volume: 0 };
    
    try {
      const raw = await fs.readFile(f, 'utf8');
      stats = JSON.parse(raw);
    } catch (error) {
      // File doesn't exist yet, use default stats
    }
    
    stats.trades += 1;
    if (position.finalPnl > 0) {
      stats.wins += 1;
    }
    stats.pnl += position.finalPnl;
    stats.volume += position.notionalValue;
    
    await fs.writeFile(f, JSON.stringify(stats, null, 2));
    console.log(`Updated wallet stats for ${wallet}`);
  } catch (error) {
    console.error('Error updating wallet stats:', error);
  }
}

async function storeClosedPosition(position) {
  try {
    await fs.mkdir('data', { recursive: true });
    const assetDir = `data/${position.asset}`;
    await fs.mkdir(assetDir, { recursive: true });
    
    let closedPositions = [];
    try {
      const data = await fs.readFile(`${assetDir}/closed_positions.json`, 'utf8');
      closedPositions = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, use empty array
    }
    
    closedPositions.push(position);
    await fs.writeFile(`${assetDir}/closed_positions.json`, JSON.stringify(closedPositions, null, 2));
    console.log(`Closed position data saved for ${position.wallet} on ${position.asset}`);
    
    if (position.closed) {
      await updateWalletStats(position);
    }
  } catch (error) {
    console.error('Error storing closed position data:', error);
  }
}

// Store trade data to a JSON file
async function storeTradeData(trades) {
  try {
    // Group trades by asset
    const tradesByAsset = {};
    
    for (const trade of trades) {
      if (!tradesByAsset[trade.asset]) {
        tradesByAsset[trade.asset] = [];
      }
      tradesByAsset[trade.asset].push(trade);
    }
    
    // Store trades for each asset
    for (const [asset, assetTrades] of Object.entries(tradesByAsset)) {
      // Create directory if it doesn't exist
      await fs.mkdir('data', { recursive: true });
      
      // Create asset-specific directory
      const assetDir = `data/${asset}`;
      await fs.mkdir(assetDir, { recursive: true });
      
      // Read existing data or create new array
      let allTrades = [];
      try {
        const data = await fs.readFile(`${assetDir}/whale_trades.json`, 'utf8');
        allTrades = JSON.parse(data);
      } catch (error) {
        // File doesn't exist yet, use empty array
      }
      
      // Add new trades
      allTrades.push(...assetTrades);
      
      // Keep only the most recent 1000 trades
      if (allTrades.length > 1000) {
        allTrades = allTrades.slice(-1000);
      }
      
      // Write back to file
      await fs.writeFile(`${assetDir}/whale_trades.json`, JSON.stringify(allTrades, null, 2));
      
      console.log(`Saved ${assetTrades.length} whale trades for ${asset}`);
    }
  } catch (error) {
    console.error('Error storing trade data:', error);
  }
}

// Post position to Twitter
async function postPositionToTwitter(position) {
  try {
    await tweetRateLimiter.waitForSlot();
    const stats = await getWalletStats(position.wallet, position.asset);
    const txLink = position.hash ? `\n\n🔗 https://app.hyperliquid.xyz/explorer/tx/${position.hash}` : '';
    const tweetText = formatMobyStylePositionTweet(position, stats) + txLink;
    console.log('Posting to Twitter:', tweetText);
    await twitterClient.v2.tweet(tweetText);
  } catch (error) {
    console.error('Error posting position tweet:', error);
  }
}

// Post position update to Twitter
async function postPositionUpdateToTwitter(position) {
  try {
    await tweetRateLimiter.waitForSlot();
    const stats = await getWalletStats(position.wallet, position.asset);
    const txLink = position.hash ? `\n\n🔗 https://app.hyperliquid.xyz/explorer/tx/${position.hash}` : '';
    const tweetText = formatMobyStylePositionUpdateTweet(position, stats) + txLink;
    console.log('Posting to Twitter:', tweetText);
    await twitterClient.v2.tweet(tweetText);
  } catch (error) {
    console.error('Error posting position update tweet:', error);
  }
}

// Post position closure to Twitter
async function postPositionClosureToTwitter(position) {
  try {
    await tweetRateLimiter.waitForSlot();
    const stats = await getWalletStats(position.wallet, position.asset);
    const txLink = position.hash ? `\n\n🔗 https://app.hyperliquid.xyz/explorer/tx/${position.hash}` : '';
    const tweetText = formatMobyStylePositionClosureTweet(position, stats) + txLink;
    console.log('Posting to Twitter:', tweetText);
    await twitterClient.v2.tweet(tweetText);
  } catch (error) {
    console.error('Error posting position closure tweet:', error);
  }
}

// Post trade to Twitter
async function postTradeToTwitter(trade) {
  try {
    console.log('Logging whale trade:', {
      asset: trade.asset,
      size: trade.size,
      notionalValue: trade.notionalValue,
      explorerLink: `https://app.hyperliquid.xyz/explorer/tx/${trade.hash}`
    });

    // Initialize trade with default values
    const tradeData = {
      ...trade,
      liquidationPrice: 0,
      leverage: 1,
      entryPrice: trade.price
    };

    // Try each wallet address until we find one with a position
    let pos = null;
    for (const w of trade.wallets) {
      pos = await getPositionDetails(w, trade.asset);
      if (pos) { 
        tradeData.wallet = w; 
        break; 
      }
    }

    if (pos) {
      tradeData.leverage = pos.leverage;
      tradeData.liquidationPrice = pos.liquidationPrice;
      tradeData.entryPrice = pos.entryPrice;
      tradeData.size = pos.size;
    }

    // Try to get wallet stats, but don't fail if we can't get them
    let stats = null;
    try {
      stats = await getWalletStats(tradeData.wallet || "unknown", trade.asset);
    } catch (error) {
      console.log('Could not fetch wallet stats:', error.message);
    }

    const txLink = `https://app.hyperliquid.xyz/explorer/tx/${trade.hash}`;
    const tweetText = formatMobyStyleTradeTweet(tradeData, stats) + `\n\n🔗 ${txLink}`;
    console.log('Logged whale trade:', tweetText);

    // Log to JSON file
    const logEntry = {
      timestamp: new Date().toISOString(),
      trade: tradeData,
      tweetText: tweetText
    };

    // Create directory if it doesn't exist
    await fs.mkdir('logs', { recursive: true });

    // Read existing logs or create new array
    let logs = [];
    try {
      const data = await fs.readFile('logs/whale_trades_log.json', 'utf8');
      logs = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, use empty array
    }

    // Add new log entry
    logs.push(logEntry);

    // Write back to file
    await fs.writeFile('logs/whale_trades_log.json', JSON.stringify(logs, null, 2));
    console.log('Whale trade logged to file.');
  } catch (error) {
    console.error('Error logging whale trade:', error);
  }
}

// Handle graceful shutdown
function handleShutdown() {
  console.log('Shutting down gracefully...');
  
  // Close WebSocket connection
  closeWebSocket();
  
  // Additional cleanup here if needed
  
  console.log('Cleanup complete. Exiting.');
  process.exit(0);
}

// Set up cleanup on process termination
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// Main function
async function main() {
  console.log(`Hyperliquid Whale Bot starting...`);
  console.log(`Monitoring assets: ${MONITORED_ASSETS.join(', ')}`);
  
  // Test Twitter connection
  try {
    const now = new Date().toISOString();
    const testTweetText = `🤖 Hyperliquid Whale Bot is now running! Monitoring trades above $100K. (${now})`;
    console.log('Testing Twitter connection...');
    const testTweet = await twitterClient.v2.tweet(testTweetText);
    console.log('✅ Twitter test tweet posted:', testTweet.data.id);
  } catch (error) {
    console.error('❌ Twitter connection test failed:', error);
    if (error.data) {
      console.error('Twitter API Error Details:', error.data);
    }
  }
  
  // Initialize asset indices (needed for API calls)
  await initializeAssetIndices();
  
  // Scan for current whale positions immediately
  await scanWhalePositions();
  
  // Connect to WebSocket for real-time updates
  const ws = connectWebSocket(handleWebSocketMessage);
  
  // Scan for new positions every 5 minutes
  setInterval(scanWhalePositions, 5 * 60 * 1000);
  
  console.log('Bot is now running! Press Ctrl+C to stop.');
}

// Run the main function
main().catch(error => {
  console.error('Error in main function:', error);
}); 