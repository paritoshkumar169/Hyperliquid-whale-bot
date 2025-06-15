import fs from 'fs/promises';

export function formatMobyStylePositionTweet(position, stats) {
  const { wallet, asset, direction, notionalValue, leverage, liquidationPrice } = position;
  const shortWallet = `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  const action = direction === 'LONG' ? 'longed' : 'shorted';
  
  let statsText = '';
  if (stats) {
    const statItems = [
      stats.winRate ? `Win Rate: ${stats.winRate}%` : '',
      stats.pnl ? `PnL: ${stats.pnl}` : '',
      stats.totalVolume ? `Vol: $${(stats.totalVolume/1000000).toFixed(1)}M` : '',
      stats.pnl30d ? `30D PnL: ${stats.pnl30d}` : '',
      stats.roi30d ? `30D ROI: ${stats.roi30d}%` : ''
    ].filter(Boolean).join(' | ');
    
    if (statItems) statsText = `\n${shortWallet}: ${statItems}`;
  }
  
  return `User ${action} $${(notionalValue/1000).toFixed(0)}K at $${position.entryPrice.toLocaleString()} (${leverage}x leverage, liquidation at $${liquidationPrice.toLocaleString()})${statsText}`;
}

export function formatMobyStyleTradeTweet(trade) {
  const { asset, side, price, notionalValue, leverage, liquidationPrice } = trade;
  const action = side === 'BUY' ? 'longed' : 'shorted';
  
  return `User ${action} $${(notionalValue/1000).toFixed(0)}K at $${price.toLocaleString()} (${leverage}x leverage, liquidation at $${liquidationPrice.toLocaleString()})`;
}

export function formatMobyStylePositionUpdateTweet(position, stats) {
  const { wallet, asset, direction, notionalValue, sizeDelta, leverage, liquidationPrice } = position;
  const shortWallet = `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  const action = sizeDelta > 0 ? 'added' : 'reduced';
  const changeAmount = Math.abs(sizeDelta * position.entryPrice/1000).toFixed(0);
  
  let statsText = '';
  if (stats) {
    const statItems = [
      stats.winRate ? `Win Rate: ${stats.winRate}%` : '',
      stats.pnl ? `PnL: ${stats.pnl}` : '',
      stats.pnl30d ? `30D PnL: ${stats.pnl30d}` : '',
      stats.roi30d ? `30D ROI: ${stats.roi30d}%` : ''
    ].filter(Boolean).join(' | ');
    
    if (statItems) statsText = `\n${shortWallet}: ${statItems}`;
  }
  
  return `User ${action} $${changeAmount}K to ${direction} position ($${(notionalValue/1000).toFixed(0)}K total, ${leverage}x leverage, liquidation at $${liquidationPrice.toLocaleString()})${statsText}`;
}

export function formatMobyStylePositionClosureTweet(position, stats) {
  const { wallet, asset, direction, finalPnl, finalPnlPercent, leverage, liquidationPrice } = position;
  const shortWallet = `${wallet.substring(0, 6)}...${wallet.substring(wallet.length - 4)}`;
  const pnlPrefix = finalPnl >= 0 ? '+' : '';
  
  return `User closed ${direction} position: ${pnlPrefix}$${Math.abs(finalPnl/1000).toFixed(0)}K (${finalPnlPercent >= 0 ? '+' : ''}${finalPnlPercent.toFixed(1)}%, ${leverage}x leverage, liquidation at $${liquidationPrice.toLocaleString()})\n${shortWallet}`;
}

export async function getWalletStats(wallet) {
  try {
    const f = `data/wallets/${wallet}.json`;
    const raw = await fs.readFile(f, 'utf8');
    const s = JSON.parse(raw);
    const winRate = s.trades ? ((s.wins / s.trades) * 100).toFixed(0) : 0;
    return { winRate, pnl: `$${s.pnl.toLocaleString()}`, totalVolume: s.volume };
  } catch (error) {
    console.error("Error getting wallet stats:", error);
    return null;
  }
} 