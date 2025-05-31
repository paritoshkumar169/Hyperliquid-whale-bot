// hyperliquid.js
import WebSocket from 'ws';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

// Hyperliquid API endpoints
const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz';
const HYPERLIQUID_WS_URL = 'wss://api.hyperliquid.xyz/ws';

// Minimum position size to track (in USD)
const MIN_POSITION_VALUE = 1_000_000; // $1 million

// Assets to monitor - focus on BTC, ETH, and SOL
const MONITORED_ASSETS = ['BTC', 'ETH', 'SOL'];

// Cache for asset prices
const assetPriceCache = {
  lastUpdated: 0,
  prices: {}
};

// WebSocket connection state
let wsConnection = null;
let wsReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 5000;
let wsHeartbeatInterval = null;

// Connect to Hyperliquid WebSocket
function connectWebSocket(messageHandler) {
  if (wsConnection) {
    try {
      wsConnection.terminate();
    } catch (error) {
      console.error('Error terminating existing WebSocket connection:', error);
    }
  }
  
  console.log('Connecting to Hyperliquid WebSocket...');
  
  const ws = new WebSocket(HYPERLIQUID_WS_URL);
  wsConnection = ws;
  
  ws.on('open', () => {
    console.log('Connected to Hyperliquid WebSocket');
    wsReconnectAttempts = 0;
    
    // Subscribe to trades for each monitored asset
    MONITORED_ASSETS.forEach(asset => {
      subscribeToAsset(ws, asset);
    });
    
    // Set up a heartbeat ping to keep the connection alive
    if (wsHeartbeatInterval) {
      clearInterval(wsHeartbeatInterval);
    }
    
    wsHeartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const pingMsg = JSON.stringify({ method: "ping" });
        ws.send(pingMsg);
      }
    }, 30000); // 30 second ping
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle pong responses
      if (message.channel === 'pong') {
        return;
      }
      
      messageHandler(message);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  ws.on('close', (code, reason) => {
    console.log(`WebSocket connection closed (Code: ${code}, Reason: ${reason})`);
    
    // Clear heartbeat interval
    if (wsHeartbeatInterval) {
      clearInterval(wsHeartbeatInterval);
      wsHeartbeatInterval = null;
    }
    
    // Reconnect with exponential backoff
    if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = RECONNECT_DELAY_MS * Math.pow(1.5, wsReconnectAttempts);
      wsReconnectAttempts++;
      
      console.log(`Attempting to reconnect in ${delay / 1000} seconds... (Attempt ${wsReconnectAttempts} of ${MAX_RECONNECT_ATTEMPTS})`);
      
      setTimeout(() => {
        if (messageHandler) {
          connectWebSocket(messageHandler);
        }
      }, delay);
    } else {
      console.error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts. Please restart the application.`);
    }
  });
  
  return ws;
}

// Subscribe to an asset's trades
function subscribeToAsset(ws, asset) {
  if (ws.readyState === WebSocket.OPEN) {
    console.log(`Subscribing to ${asset} trades...`);
    
    const subscribeMsg = JSON.stringify({
      "method": "subscribe",
      "subscription": {
        "type": "trades",
        "coin": asset
      }
    });
    
    ws.send(subscribeMsg);
  }
}

// Extract trade data from WebSocket messages
function extractTradeData(message) {
  if (message.channel === 'trades' && Array.isArray(message.data)) {
    return message.data.map(trade => {
      const size = parseFloat(trade.sz);
      
      // Use actual price from API or fallback to our hardcoded prices
      const asset = trade.coin;
      const price = parseFloat(trade.px);
      const notionalValue = size * price;
      
      return {
        asset,
        side: trade.side === 'B' ? 'BUY' : 'SELL',
        price,
        size,
        notionalValue,
        timestamp: new Date(parseInt(trade.time)).toISOString(),
        isWhale: notionalValue >= MIN_POSITION_VALUE,
        hash: trade.hash, // Transaction hash for linking to explorer
        tradeId: trade.tid // Unique trade ID
      };
    });
  }
  return null;
}

// Process whale trades from WebSocket
function processWhaleTrades(trades) {
  if (!trades || !Array.isArray(trades)) return [];
  
  // Filter for large trades (whale activity)
  const whaleTrades = trades.filter(trade => trade.isWhale);
  
  if (whaleTrades.length > 0) {
    console.log(`Detected ${whaleTrades.length} whale trades!`);
    whaleTrades.forEach(trade => {
      console.log(`Whale ${trade.side} ${trade.asset}: ${trade.size.toFixed(4)} ($${Math.round(trade.notionalValue).toLocaleString()}) @ $${trade.price.toLocaleString()}`);
    });
  }
  
  return whaleTrades;
}

// Fetch real-time prices directly from Hyperliquid API
async function fetchRealTimePrices() {
  try {
    // Check if we need to update the cache (every 30 seconds)
    const now = Date.now();
    if (now - assetPriceCache.lastUpdated < 30000 && Object.keys(assetPriceCache.prices).length > 0) {
      // Use cached prices if they're recent
      return assetPriceCache.prices;
    }
    
    console.log('Fetching real-time prices from Hyperliquid API...');
    
    // Using Hyperliquid's info endpoint with allMids type as per the docs
    const response = await fetch(`${HYPERLIQUID_API_URL}/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: "allMids"
      })
    });
    
    if (!response.ok) {
      throw new Error(`API response error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Build a map of asset prices
    const prices = {};
    
    // According to docs, response is a simple object with coin as key and price as string value
    if (data && typeof data === 'object') {
      MONITORED_ASSETS.forEach(asset => {
        if (data[asset]) {
          prices[asset] = parseFloat(data[asset]);
        }
      });
    }
    
    // Update cache if we got at least one price
    if (Object.keys(prices).length > 0) {
      assetPriceCache.prices = prices;
      assetPriceCache.lastUpdated = now;
      
      console.log('Real-time prices fetched successfully:');
      Object.entries(prices).forEach(([asset, price]) => {
        console.log(`- ${asset}: $${price.toLocaleString()}`);
      });
    } else {
      console.warn('No prices returned from Hyperliquid API');
      
      // If cache has data, keep using it
      if (Object.keys(assetPriceCache.prices).length > 0) {
        return assetPriceCache.prices;
      }
    }
    
    return prices;
  } catch (error) {
    console.error('Error fetching real-time prices from Hyperliquid API:', error);
    
    // If there's an error and we have cached prices, use those
    if (Object.keys(assetPriceCache.prices).length > 0) {
      console.log('Using cached prices due to API error');
      return assetPriceCache.prices;
    }
    
    // Fallback to hardcoded prices if all else fails
    console.log('Using fallback hardcoded prices');
    return {
      'BTC': 105000,
      'ETH': 3500,
      'SOL': 150
    };
  }
}

// Fetch active positions directly from the Hyperliquid API
async function fetchActivePositions() {
  try {
    console.log('Fetching active whale positions...');
    
    // For real implementation, you would query the Hyperliquid API
    // to get top positions by size for each asset
    // This would require additional API calls and data processing
    
    // For now we're just returning an empty array since we'll use
    // fetchUserPositions to scan known whale wallets
    
    return [];
  } catch (error) {
    console.error('Error fetching active positions:', error);
    return [];
  }
}

// Get position details from the API
async function getPositionDetails(wallet, asset) {
  try {
    console.log(`Getting position details for wallet ${wallet} on ${asset}...`);
    
    // Fetch user data from API
    const userData = await fetchUserPositions(wallet);
    
    if (!userData || !userData.assetPositions) {
      return null;
    }
    
    // Find position for the specific asset
    const assetPosition = userData.assetPositions.find(
      pos => pos.position && pos.position.coin === asset
    );
    
    if (!assetPosition || !assetPosition.position) {
      return null;
    }
    
    // Get current price
    const prices = await fetchRealTimePrices();
    const currentPrice = prices[asset] || 0;
    
    // Extract position details
    const position = assetPosition.position;
    
    return {
      wallet,
      asset,
      size: parseFloat(position.szi),
      entryPrice: parseFloat(position.entryPx),
      currentPrice,
      pnl: parseFloat(position.unrealizedPnl || 0),
      liquidationPrice: parseFloat(position.liquidationPx || 0),
      leverage: position.leverage ? (position.leverage.value || 0) : 0,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error fetching position details for ${wallet}:`, error);
    return null;
  }
}

// Get current asset price
async function getAssetPrice(asset) {
  const prices = await fetchRealTimePrices();
  return prices[asset] || 0;
}

// Get supported assets
async function getSupportedAssets() {
  try {
    const prices = await fetchRealTimePrices();
    return MONITORED_ASSETS.map(name => ({ 
      name, 
      price: prices[name] || 0
    }));
  } catch (error) {
    console.error('Error fetching supported assets:', error);
    return [];
  }
}

// Fetch metadata and asset contexts from Hyperliquid API
async function fetchMetaAndAssetCtxs() {
  try {
    console.log('Fetching asset metadata and contexts...');
    
    const response = await fetch(`${HYPERLIQUID_API_URL}/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: "metaAndAssetCtxs"
      })
    });
    
    if (!response.ok) {
      throw new Error(`API response error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (Array.isArray(data) && data.length >= 2) {
      // First element contains metadata
      const metadata = data[0];
      // Second element contains asset contexts array
      const assetContexts = data[1];
      
      return {
        metadata,
        assetContexts
      };
    } else {
      throw new Error('Unexpected response format from metaAndAssetCtxs');
    }
  } catch (error) {
    console.error('Error fetching asset metadata and contexts:', error);
    return null;
  }
}

// Fetch user's clearinghouse state (account data) for all positions
async function fetchUserPositions(wallet) {
  try {
    console.log(`Fetching positions for wallet ${wallet}...`);
    
    const response = await fetch(`${HYPERLIQUID_API_URL}/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: "clearinghouseState",
        user: wallet
      })
    });
    
    if (!response.ok) {
      throw new Error(`API response error: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching user positions for ${wallet}:`, error);
    return null;
  }
}

// Get the universe info (list of available assets)
async function fetchUniverse() {
  try {
    console.log('Fetching universe information...');
    
    const response = await fetch(`${HYPERLIQUID_API_URL}/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: "meta"
      })
    });
    
    if (!response.ok) {
      throw new Error(`API response error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data && data.universe) {
      return data.universe;
    } else {
      throw new Error('Unexpected response format from meta endpoint');
    }
  } catch (error) {
    console.error('Error fetching universe information:', error);
    return [];
  }
}

// Close WebSocket connection gracefully
function closeWebSocket() {
  if (wsHeartbeatInterval) {
    clearInterval(wsHeartbeatInterval);
    wsHeartbeatInterval = null;
  }
  
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    wsConnection.close(1000, 'Application shutting down');
  }
}

export { 
  connectWebSocket, 
  fetchActivePositions, 
  getPositionDetails,
  extractTradeData,
  processWhaleTrades,
  getAssetPrice,
  getSupportedAssets,
  closeWebSocket,
  MONITORED_ASSETS,
  fetchRealTimePrices,
  fetchMetaAndAssetCtxs,
  fetchUserPositions,
  fetchUniverse
}; 