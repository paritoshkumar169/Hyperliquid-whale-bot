import WebSocket from 'ws';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();


const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz';
const HYPERLIQUID_WS_URL = 'wss://api.hyperliquid.xyz/ws';


const MIN_POSITION_VALUE = 10_000; 


const MONITORED_ASSETS = ['BTC', 'ETH', 'SOL'];


const assetPriceCache = {
  lastUpdated: 0,
  prices: {}
};


let wsConnection = null;
let wsReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 5000;
let wsHeartbeatInterval = null;


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
    
    
    MONITORED_ASSETS.forEach(asset => {
      subscribeToAsset(ws, asset);
    });
    
    
    if (wsHeartbeatInterval) {
      clearInterval(wsHeartbeatInterval);
    }
    
    wsHeartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const pingMsg = JSON.stringify({ method: "ping" });
        ws.send(pingMsg);
      }
    }, 30000); 
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      
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
    
    
    if (wsHeartbeatInterval) {
      clearInterval(wsHeartbeatInterval);
      wsHeartbeatInterval = null;
    }
    
    
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


function extractTradeData(message) {
  if (message.channel === 'trades' && Array.isArray(message.data)) {
    return message.data.map(trade => {
      const size = parseFloat(trade.sz);
      
      
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
        hash: trade.hash, 
        tradeId: trade.tid 
      };
    });
  }
  return null;
}


function processWhaleTrades(trades) {
  if (!trades || !Array.isArray(trades)) return [];
  
  
  const whaleTrades = trades.filter(trade => trade.isWhale);
  
  if (whaleTrades.length > 0) {
    console.log(`Detected ${whaleTrades.length} whale trades!`);
    whaleTrades.forEach(trade => {
      console.log(`Whale ${trade.side} ${trade.asset}: ${trade.size.toFixed(4)} ($${Math.round(trade.notionalValue).toLocaleString()}) @ $${trade.price.toLocaleString()}`);
    });
  }
  
  return whaleTrades;
}


async function fetchRealTimePrices() {
  try {
    
    const now = Date.now();
    if (now - assetPriceCache.lastUpdated < 30000 && Object.keys(assetPriceCache.prices).length > 0) {
      
      return assetPriceCache.prices;
    }
    
    console.log('Fetching real-time prices from Hyperliquid API...');
    
    
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
    
    
    const prices = {};
    
    
    if (data && typeof data === 'object') {
      MONITORED_ASSETS.forEach(asset => {
        if (data[asset]) {
          prices[asset] = parseFloat(data[asset]);
        }
      });
    }
    
    
    if (Object.keys(prices).length > 0) {
      assetPriceCache.prices = prices;
      assetPriceCache.lastUpdated = now;
      
      console.log('Real-time prices fetched successfully:');
      Object.entries(prices).forEach(([asset, price]) => {
        console.log(`- ${asset}: $${price.toLocaleString()}`);
      });
    } else {
      console.error('No prices available and API failed.');
      return {};
    }
    
    return prices;
  } catch (error) {
    console.error('Error fetching real-time prices from Hyperliquid API:', error);
    
    
    if (Object.keys(assetPriceCache.prices).length > 0) {
      console.log('Using cached prices due to API error');
      return assetPriceCache.prices;
    }
    
    
    console.error('No prices available and API failed.');
    return {};
  }
}


async function fetchActivePositions() {
  try {
    console.log('Fetching active whale positions...');
    const activePositions = [];
    
    for (const asset of MONITORED_ASSETS) {
      const response = await fetch(`${HYPERLIQUID_API_URL}/info`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: "clearinghouseState",
          coin: asset
        })
      });
      
      if (!response.ok) {
        throw new Error(`API response error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data && Array.isArray(data)) {
        data.forEach(position => {
          if (position && position.position) {
            const size = parseFloat(position.position.szi);
            const price = parseFloat(position.position.entryPx);
            const notionalValue = Math.abs(size) * price;
            
            if (notionalValue >= MIN_POSITION_VALUE) {
              activePositions.push({
                wallet: position.user,
                asset,
                size,
                direction: size > 0 ? 'LONG' : 'SHORT',
                notionalValue,
                entryPrice: price,
                liquidationPrice: parseFloat(position.position.liquidationPx || 0),
                leverage: position.position.leverage ? (position.position.leverage.value || 0) : 0,
                pnl: parseFloat(position.position.unrealizedPnl || 0),
                timestamp: new Date().toISOString()
              });
            }
          }
        });
      }
    }
    
    return activePositions;
  } catch (error) {
    console.error('Error fetching active positions:', error);
    return [];
  }
}


async function getPositionDetails(wallet, asset) {
  try {
    console.log(`Getting position details for wallet ${wallet} on ${asset}...`);
    
    
    const userData = await fetchUserPositions(wallet);
    
    if (!userData || !userData.assetPositions) {
      return null;
    }
    
    
    const assetPosition = userData.assetPositions.find(
      pos => pos.position && pos.position.coin === asset
    );
    
    if (!assetPosition || !assetPosition.position) {
      return null;
    }
    
    
    const prices = await fetchRealTimePrices();
    const currentPrice = prices[asset] || 0;
    
    
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


async function getAssetPrice(asset) {
  const prices = await fetchRealTimePrices();
  return prices[asset] || 0;
}


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
      
      const metadata = data[0];
      
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
  fetchUniverse,
  HYPERLIQUID_API_URL
}; 