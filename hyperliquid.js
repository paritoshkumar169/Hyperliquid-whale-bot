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

// For demo/testing - use hardcoded BTC price
const BTC_PRICE = 105000;

// Connect to Hyperliquid WebSocket
function connectWebSocket(messageHandler) {
  const ws = new WebSocket(HYPERLIQUID_WS_URL);
  
  ws.on('open', () => {
    console.log('Connected to Hyperliquid WebSocket');
    
    // Subscribe to trades
    const subscribeMsg = JSON.stringify({
      "method": "subscribe",
      "subscription": {
        "type": "trades",
        "coin": "BTC"
      }
    });
    ws.send(subscribeMsg);
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      messageHandler(message);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  ws.on('close', () => {
    console.log('WebSocket connection closed, attempting to reconnect...');
    setTimeout(() => connectWebSocket(messageHandler), 5000);
  });
  
  return ws;
}

// Extract trade data from WebSocket messages
function extractTradeData(message) {
  if (message.channel === 'trades' && Array.isArray(message.data)) {
    return message.data.map(trade => {
      const size = parseFloat(trade.sz);
      const price = parseFloat(trade.px);
      const notionalValue = size * price;
      
      return {
        asset: trade.coin,
        side: trade.side === 'B' ? 'BUY' : 'SELL',
        price,
        size,
        notionalValue,
        timestamp: new Date(parseInt(trade.time)).toISOString(),
        isWhale: notionalValue >= MIN_POSITION_VALUE
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
      console.log(`Whale ${trade.side} ${trade.asset}: ${trade.size} @ $${trade.price} ($${Math.round(trade.notionalValue).toLocaleString()})`);
    });
  }
  
  return whaleTrades;
}

// For demonstration purposes, generate some sample whale positions
function generateSampleWhalePositions() {
  console.log('Generating sample whale positions for demonstration...');
  
  return [
    {
      wallet: '0x7ac71c29ef4faddea7d9bac833585567a5d3f581',
      asset: 'BTC',
      size: 15.25,
      direction: 'LONG',
      notionalValue: 15.25 * BTC_PRICE,
      entryPrice: 98500,
      leverage: 10,
      pnl: (BTC_PRICE - 98500) * 15.25,
      liquidationPrice: 88650,
      timestamp: new Date().toISOString()
    },
    {
      wallet: '0x1234567890abcdef1234567890abcdef12345678',
      asset: 'BTC',
      size: -25.75,
      direction: 'SHORT',
      notionalValue: 25.75 * BTC_PRICE,
      entryPrice: 112000,
      leverage: 20,
      pnl: (112000 - BTC_PRICE) * 25.75,
      liquidationPrice: 117600,
      timestamp: new Date().toISOString()
    },
    {
      wallet: '0xabcdef1234567890abcdef1234567890abcdef12',
      asset: 'BTC',
      size: 10.5,
      direction: 'LONG',
      notionalValue: 10.5 * BTC_PRICE,
      entryPrice: 102500,
      leverage: 5,
      pnl: (BTC_PRICE - 102500) * 10.5,
      liquidationPrice: 92250,
      timestamp: new Date().toISOString()
    }
  ];
}

// Get whale positions (for demonstration)
async function fetchActivePositions() {
  try {
    console.log('Fetching active whale positions...');
    
    // For demonstration, return sample positions
    // In a production environment, we would fetch real data from the API
    return generateSampleWhalePositions();
  } catch (error) {
    console.error('Error fetching active positions:', error);
    return [];
  }
}

// Get position details (simulation)
async function getPositionDetails(wallet, asset = 'BTC') {
  try {
    console.log(`Getting position details for wallet ${wallet}...`);
    
    // For demonstration purposes, return a sample position if the wallet matches
    const samplePositions = generateSampleWhalePositions();
    const position = samplePositions.find(pos => pos.wallet === wallet);
    
    if (position) {
      return {
        wallet,
        asset,
        size: position.size,
        entryPrice: position.entryPrice,
        currentPrice: BTC_PRICE,
        pnl: position.pnl,
        liquidationPrice: position.liquidationPrice,
        leverage: position.leverage,
        timestamp: new Date().toISOString()
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching position details for ${wallet}:`, error);
    return null;
  }
}

export { 
  connectWebSocket, 
  fetchActivePositions, 
  getPositionDetails,
  extractTradeData,
  processWhaleTrades
}; 