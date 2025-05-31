// tweetFormats.js - Tweet formatting utilities
import fs from 'fs/promises';

export function formatMobyStylePositionTweet(position, stats) {
  const { wallet, asset, direction, notionalValue } = position;
  const shortWallet = `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  const action = direction === 'LONG' ? 'bought' : 'sold';
  
  let statsText = '';
  if (stats) {
    const statItems = [
      stats.winRate ? `Win Rate: ${stats.winRate}%` : '',
      stats.pnl ? `PnL: ${stats.pnl}` : '',
      stats.totalVolume ? `Vol: $${(stats.totalVolume/1000000).toFixed(1)}M` : ''
    ].filter(Boolean).join(' | ');
    
    if (statItems) statsText = `\n${shortWallet}: ${statItems}`;
  }
  
  return `🐳 $${asset} whale ${action} $${(notionalValue/1000).toFixed(0)}K at $${position.entryPrice.toLocaleString()}${statsText}\n#Hyperliquid #${asset}`;
}

export function formatMobyStyleTradeTweet(trade) {
  const { asset, side, price, notionalValue } = trade;
  const action = side === 'BUY' ? 'bought' : 'sold';
  
  return `🐳 $${asset} whale ${action} $${(notionalValue/1000).toFixed(0)}K at $${price.toLocaleString()}\n#Hyperliquid #${asset}`;
}

export function formatMobyStylePositionUpdateTweet(position, stats) {
  const { wallet, asset, direction, notionalValue, sizeDelta } = position;
  const shortWallet = `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  const action = sizeDelta > 0 ? 'added' : 'reduced';
  const changeAmount = Math.abs(sizeDelta * position.entryPrice/1000).toFixed(0);
  
  let statsText = '';
  if (stats) {
    const statItems = [
      stats.winRate ? `Win Rate: ${stats.winRate}%` : '',
      stats.pnl ? `PnL: ${stats.pnl}` : ''
    ].filter(Boolean).join(' | ');
    
    if (statItems) statsText = `\n${shortWallet}: ${statItems}`;
  }
  
  return `🐳 $${asset} whale ${action} $${changeAmount}K to ${direction} position ($${(notionalValue/1000).toFixed(0)}K total)${statsText}\n#Hyperliquid #${asset}`;
}

export function formatMobyStylePositionClosureTweet(position, stats) {
  const { wallet, asset, direction, finalPnl, finalPnlPercent } = position;
  const shortWallet = `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  const pnlPrefix = finalPnl >= 0 ? '+' : '';
  
  return `🐳 $${asset} whale closed ${direction} position: ${pnlPrefix}$${Math.abs(finalPnl/1000).toFixed(0)}K (${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(1)}%)\n${shortWallet}\n#Hyperliquid #${asset}`;
}

export async function getWalletStats(wallet, asset) {
  try {
    // In a production environment, this would fetch real wallet stats
    // from your database or analytics system
    return null;
  } catch (error) {
    console.error("Error getting wallet stats:", error);
    return null;
  }
} 