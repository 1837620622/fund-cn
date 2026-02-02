// ============================================================
// 国内基金 - 实时行情系统 (Cloudflare Worker)
// 作者：万能程序员
// ============================================================

import fundList from '../fund-list.json'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const mobileHeaders = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
  'Referer': 'https://mpservice.com/',
  'Accept': 'application/json'
}

const fetchHeaders = {
  'Referer': 'https://fund.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
    try {
      if (path === '/') return handleHome()
      if (path === '/api/fund-list') return jsonResponse(fundList)
      if (path === '/api/indices') return handleIndices()
      if (path === '/api/ranking') return handleRanking(url)
      if (path === '/api/ranking/estimate') return handleEstimateRanking(url)
      if (path === '/api/fund/estimate') return handleEstimate(url)
      if (path.match(/^\/api\/fund\/\d+\/detail$/)) return handleDetail(path)
      if (path.match(/^\/api\/fund\/\d+\/portfolio$/)) return handlePortfolio(path)
      if (path.match(/^\/api\/fund\/\d+\/performance$/)) return handlePerformance(path)
      return new Response('Not Found', { status: 404 })
    } catch (e) {
      return jsonResponse({ error: e.message }, 500)
    }
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

async function handleIndices() {
  try {
    const res = await fetch(`https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001,0.399006,1.000688&fields=f2,f3,f4,f12,f14&_=${Date.now()}`, { headers: fetchHeaders })
    const data = await res.json()
    if (!data?.data?.diff) return jsonResponse({ indices: [] })
    const indices = data.data.diff.map(i => ({ code: i.f12, name: i.f14, current: i.f2.toFixed(2), change: i.f4.toFixed(2), rate: i.f3.toFixed(2) }))
    return jsonResponse({ indices })
  } catch (e) { return jsonResponse({ indices: [] }) }
}

async function handleRanking(url) {
  const type = url.searchParams.get('type') || 'up'
  const limit = parseInt(url.searchParams.get('limit') || '20')
  const order = type === 'up' ? 'desc' : 'asc'
  try {
    const res = await fetch(`https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=rzdf&st=${order}&pi=1&pn=${limit}&dx=1&v=${Date.now()}`, { headers: fetchHeaders })
    const text = await res.text()
    const match = text.match(/datas:\s*\[(.*?)\]/s)
    if (!match) return jsonResponse({ ranking: [] })
    const ranking = JSON.parse(`[${match[1]}]`).map(row => { const c = row.split(','); return { code: c[0], name: c[1], type: c[3], netValue: c[4], dayChange: parseFloat(c[6]) || 0 } })
    return jsonResponse({ ranking })
  } catch (e) { return jsonResponse({ ranking: [] }) }
}

async function handleEstimateRanking(url) {
  const type = url.searchParams.get('type') || 'up'
  const limit = parseInt(url.searchParams.get('limit') || '20')
  try {
    // 获取热门基金列表（取前50只进行估值获取）
    const rankRes = await fetch(`https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=6yzf&st=desc&pi=1&pn=50&dx=1&v=${Date.now()}`, { headers: fetchHeaders })
    const rankText = await rankRes.text()
    const rankMatch = rankText.match(/datas:\s*\[(.*?)\]/s)
    if (!rankMatch) return jsonResponse({ ranking: [] })
    const fundCodes = JSON.parse(`[${rankMatch[1]}]`).map(row => row.split(',')[0])
    
    // 并发获取实时估值
    const estimates = await Promise.all(fundCodes.map(async code => {
      try {
        const res = await fetch(`https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`, { headers: fetchHeaders })
        const text = await res.text()
        const match = text.match(/jsonpgz\((.*)\)/)
        if (!match?.[1]) return null
        const d = JSON.parse(match[1])
        return { code: d.fundcode, name: d.name, estimate: d.gsz, estimateChange: parseFloat(d.gszzl) || 0, estimateTime: d.gztime }
      } catch { return null }
    }))
    
    // 过滤有效数据并排序
    const valid = estimates.filter(e => e !== null && !isNaN(e.estimateChange))
    valid.sort((a, b) => type === 'up' ? b.estimateChange - a.estimateChange : a.estimateChange - b.estimateChange)
    return jsonResponse({ ranking: valid.slice(0, limit) })
  } catch (e) { return jsonResponse({ ranking: [] }) }
}

async function handleEstimate(url) {
  const code = url.searchParams.get('code')
  if (!code) return jsonResponse({ error: 'code required' }, 400)
  try {
    const res = await fetch(`https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`, { headers: fetchHeaders })
    const text = await res.text()
    const match = text.match(/jsonpgz\((.*)\)/)
    if (!match?.[1]) return jsonResponse({ error: 'no data' }, 404)
    const d = JSON.parse(match[1])
    return jsonResponse({ code: d.fundcode, name: d.name, netValue: d.dwjz, estimate: d.gsz, estimateChange: d.gszzl, estimateTime: d.gztime, netValueDate: d.jzrq })
  } catch (e) { return jsonResponse({ error: e.message }, 500) }
}

async function handleDetail(path) {
  const code = path.split('/')[3]
  try {
    const res = await fetch(`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNDetailInformation?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&_=${Date.now()}`, { headers: mobileHeaders })
    const data = await res.json()
    if (!data?.Datas) return jsonResponse({ detail: null })
    const d = data.Datas
    return jsonResponse({ detail: { code: d.FCODE, name: d.SHORTNAME, fullName: d.FULLNAME, type: d.FTYPE, establishDate: d.ESTABDATE, scale: d.ENDNAV ? (parseFloat(d.ENDNAV)/1e8).toFixed(2)+'亿' : '--', rating: d.RLEVEL_SZ, company: d.JJGS, custodian: d.TGYH, manager: d.JJJL, manageFee: d.MGREXP, trustFee: d.TRUSTEXP }})
  } catch (e) { return jsonResponse({ detail: null }) }
}

async function handlePortfolio(path) {
  const code = path.split('/')[3]
  try {
    const res = await fetch(`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&_=${Date.now()}`, { headers: mobileHeaders })
    const data = await res.json()
    if (!data?.Datas?.fundStocks) return jsonResponse({ stocks: [], updateDate: '' })
    const stocks = data.Datas.fundStocks.map(s => ({ code: s.GPDM, name: s.GPJC, percent: parseFloat(s.JZBL) || 0, change: s.PCTNVCHGTYPE, industry: s.INDEXNAME }))
    return jsonResponse({ stocks, updateDate: data.Datas.FSRQ || '' })
  } catch (e) { return jsonResponse({ stocks: [] }) }
}

async function handlePerformance(path) {
  const code = path.split('/')[3]
  try {
    const res = await fetch(`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNPeriodIncrease?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0&_=${Date.now()}`, { headers: mobileHeaders })
    const data = await res.json()
    if (!data?.Datas) return jsonResponse({ performance: [] })
    const labelMap = { Z:'近1周', Y:'近1月', '3Y':'近3月', '6Y':'近6月', '1N':'近1年', '2N':'近2年', '3N':'近3年', LN:'成立来' }
    const performance = data.Datas.map(p => ({ period: p.title, label: labelMap[p.title] || p.title, value: parseFloat(p.syl) || 0, rank: p.rank, total: p.sc }))
    return jsonResponse({ performance, establishDate: data.Expansion?.ESTABDATE })
  } catch (e) { return jsonResponse({ performance: [] }) }
}

function handleHome() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>国内基金 - 实时行情</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect fill='%23f0b90b' rx='20' width='100' height='100'/><text x='50' y='68' text-anchor='middle' fill='%23000' font-size='50' font-weight='bold'>CN</text></svg>">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
--bg:#0b0e11;--bg2:#12161c;--bg3:#1e2329;--bg4:#2b3139;
--border:#2b3139;--text:#eaecef;--text2:#848e9c;--text3:#5e6673;
--up:#f6465d;--up-bg:rgba(246,70,93,0.12);
--down:#0ecb81;--down-bg:rgba(14,203,129,0.12);
--gold:#f0b90b;--blue:#2962ff
}
html,body{height:100%}
body{font-family:'Noto Sans SC',system-ui,sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;position:relative;min-height:100vh}
.mono{font-family:'JetBrains Mono',monospace}

.topbar{background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
.topbar-inner{display:flex;justify-content:space-between;align-items:center;height:50px;padding:0 16px;max-width:1200px;margin:0 auto}
.logo{font-size:18px;font-weight:700;color:var(--gold)}
.logo span{color:var(--text)}
.clock{color:var(--text2);font-size:12px;display:flex;align-items:center;gap:6px}
.live-dot{width:6px;height:6px;background:var(--down);border-radius:50%;animation:blink 1.5s infinite}
@keyframes blink{50%{opacity:.3}}

.ticker{background:var(--bg2);border-bottom:1px solid var(--border);overflow-x:auto;-webkit-overflow-scrolling:touch}
.ticker-inner{display:flex;padding:10px 16px;gap:0;max-width:1200px;margin:0 auto}
.ticker-item{flex:0 0 auto;padding:0 16px;border-right:1px solid var(--border);min-width:140px}
.ticker-item:last-child{border-right:none}
.ticker-name{font-size:11px;color:var(--text2);margin-bottom:2px}
.ticker-price{font-size:18px;font-weight:600}
.ticker-change{font-size:11px}
.up{color:var(--up)}.down{color:var(--down)}

.container{max-width:1200px;margin:0 auto;padding:12px 16px;position:relative;z-index:1}

@media(min-width:768px){
  .main-grid{display:grid;grid-template-columns:320px 1fr;gap:16px}
  .ticker-item{min-width:180px;padding:0 24px}
  .ticker-price{font-size:22px}
}
@media(max-width:767px){
  .main-grid{display:flex;flex-direction:column;gap:12px}
  .watchlist-section{order:1}
  .ranking-section{order:2}
}

.search{position:relative;margin-bottom:12px}
.search-input{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 14px 10px 36px;color:var(--text);font-size:14px}
.search-input:focus{outline:none;border-color:var(--gold)}
.search-input::placeholder{color:var(--text3)}
.search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:13px;width:16px;height:16px}
.dropdown{position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border);border-radius:6px;margin-top:4px;max-height:300px;overflow-y:auto;display:none;z-index:50}
.dropdown.show{display:block}
.dd-item{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer}
.dd-item:hover{background:var(--bg3)}
.dd-item:last-child{border-bottom:none}
.dd-code{color:var(--gold);font-weight:600;margin-right:10px;font-size:13px}

.panel{background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px}
.panel-header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border)}
.panel-title{font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px}
.panel-title svg{width:16px;height:16px;fill:var(--gold)}
.tabs{display:flex;gap:2px}
.tab{padding:5px 12px;background:transparent;border:none;color:var(--text2);font-size:12px;cursor:pointer;border-radius:4px}
.tab:hover{color:var(--text)}
.tab.active{background:var(--gold);color:#000;font-weight:600}

.list-header{display:grid;grid-template-columns:2fr 1fr 1fr;padding:8px 14px;background:var(--bg3);font-size:11px;color:var(--text3)}
.list-row{display:grid;grid-template-columns:2fr 1fr 1fr;padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s}
.list-row:hover{background:var(--bg3)}
.list-row:last-child{border-bottom:none}
.fund-name{font-size:13px;font-weight:500;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fund-code{font-size:11px;color:var(--gold)}
.fund-nav{text-align:right;font-size:12px;color:var(--text2)}
.fund-chg{text-align:right;font-size:14px;font-weight:600}

.watch-row{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer}
.watch-row:hover{background:var(--bg3)}
.watch-row:last-child{border-bottom:none}
.watch-info{flex:1;min-width:0}
.watch-est{text-align:right;margin-right:10px}
.watch-est-val{font-size:15px;font-weight:600}
.watch-est-time{font-size:10px;color:var(--text3)}
.fund-remove{background:transparent;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:2px 6px}
.fund-remove:hover{color:var(--up)}

.empty{padding:30px;text-align:center;color:var(--text3);font-size:13px}

.toast{position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-100px);background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px 20px;display:flex;align-items:center;gap:8px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.5);transition:transform .3s ease}
.toast.show{transform:translateX(-50%) translateY(0)}
.toast.success{border-color:var(--up)}
.toast.success .toast-icon{color:var(--up)}
.toast.warning{border-color:var(--gold)}
.toast.warning .toast-icon{color:var(--gold)}
.toast-icon{font-size:16px}
.toast-msg{font-size:13px;color:var(--text)}

.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;justify-content:center;align-items:flex-start;padding:40px 16px;overflow-y:auto}
.modal-bg.open{display:flex}
.modal{background:var(--bg2);border:1px solid var(--border);border-radius:8px;width:100%;max-width:480px;animation:slideIn .25s ease-out}
@keyframes slideIn{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}}
.modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border)}
.modal-head-left{flex:1;min-width:0}
.modal-head h2{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.modal-head span{color:var(--gold);font-size:13px;margin-left:8px}
.modal-head-btns{display:flex;gap:8px;align-items:center}
.star-btn{background:var(--bg3);border:1px solid var(--border);border-radius:4px;color:var(--text2);font-size:12px;padding:6px 12px;cursor:pointer;display:flex;align-items:center;gap:4px}
.star-btn:hover{background:var(--bg4);color:var(--text)}
.star-btn.active{background:var(--gold);color:#000;border-color:var(--gold)}
.star-btn svg{width:14px;height:14px}
.close-btn{width:28px;height:28px;background:var(--bg3);border:none;border-radius:4px;color:var(--text2);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.close-btn:hover{background:var(--bg4);color:var(--text)}
.modal-body{padding:16px}

.est-row{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--border)}
.est-val{font-size:32px;font-weight:700}
.est-time{font-size:11px;color:var(--text3)}

.info-title{font-size:11px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px}
.perf-row{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap}
.perf-item{flex:1;min-width:70px;background:var(--bg3);padding:8px 6px;border-radius:4px;text-align:center}
.perf-label{font-size:10px;color:var(--text3);margin-bottom:2px}
.perf-val{font-size:13px;font-weight:600}

.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:16px}
.info-item{background:var(--bg3);padding:10px;border-radius:4px}
.info-item dt{font-size:10px;color:var(--text3);margin-bottom:2px}
.info-item dd{font-size:12px;font-weight:500}

.chart-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;margin-bottom:10px}
.chart-seg{height:100%}
.stock-list{display:flex;flex-direction:column;gap:4px}
.stock-row{display:flex;justify-content:space-between;padding:6px 10px;background:var(--bg3);border-radius:4px;font-size:12px}
.stock-dot{width:8px;height:8px;border-radius:2px;margin-right:8px}
.stock-pct{color:var(--gold);font-weight:600}

.footer{background:var(--bg2);border-top:1px solid var(--border);padding:24px 16px;text-align:center;margin-top:20px}
.footer-brand{font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px;letter-spacing:1px}
.footer-contact{color:var(--text2);font-size:12px;margin-bottom:6px}
.footer-contact a{color:var(--gold);text-decoration:none}
.footer-links{color:var(--text3);font-size:11px}
.footer-links a{color:var(--text3);text-decoration:none;margin:0 8px}
.footer-links a:hover{color:var(--gold)}

.spinner{width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--gold);border-radius:50%;animation:spin .6s linear infinite;margin:20px auto}
@keyframes spin{to{transform:rotate(360deg)}}

.watermark{position:fixed;bottom:20px;right:20px;font-size:11px;color:rgba(255,255,255,0.08);letter-spacing:2px;font-weight:600;pointer-events:none;z-index:0}
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-inner">
    <div class="logo"><span>国内</span>基金</div>
    <div class="clock"><span class="live-dot"></span><span class="mono" id="clock">--:--:--</span></div>
  </div>
</div>

<div class="ticker">
  <div class="ticker-inner" id="ticker"><div class="spinner"></div></div>
</div>

<div class="container">
  <div class="search">
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input type="text" class="search-input" id="searchInput" placeholder="搜索基金代码 / 名称 / 拼音">
    <div class="dropdown" id="dropdown"></div>
  </div>

  <div class="main-grid">
    <div class="watchlist-section">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title"><svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>我的自选</div>
          <div style="font-size:11px;color:var(--text3)" id="watchCount">0只</div>
        </div>
        <div id="watchlist"><div class="empty">点击基金详情右上角添加自选</div></div>
      </div>
    </div>
    
    <div class="ranking-section">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title"><svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>盘中估值榜 <span style="font-size:10px;color:var(--text3);font-weight:400">(实时)</span></div>
          <div class="tabs">
            <button class="tab active" data-type="est-up">估涨</button>
            <button class="tab" data-type="est-down">估跌</button>
          </div>
        </div>
        <div class="list-header"><span>基金名称</span><span style="text-align:right">估值</span><span style="text-align:right">估算涨跌</span></div>
        <div id="estRanking"><div class="spinner"></div></div>
      </div>
      
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title"><svg viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" fill="none"/></svg>净值涨跌榜 <span style="font-size:10px;color:var(--text3);font-weight:400">(收盘)</span></div>
          <div class="tabs" id="navTabs">
            <button class="tab active" data-type="up">涨幅</button>
            <button class="tab" data-type="down">跌幅</button>
          </div>
        </div>
        <div class="list-header"><span>基金名称</span><span style="text-align:right">净值</span><span style="text-align:right">净值涨跌</span></div>
        <div id="ranking"><div class="spinner"></div></div>
      </div>
    </div>
  </div>
</div>

<footer class="footer">
  <div class="footer-brand">POWERED BY 万能程序员</div>
  <div class="footer-contact">反馈问题 | 微信：<a href="#">1837620622</a>（备注来意）</div>
  <div class="footer-links"><a href="https://fund.chuankangkk.top/" target="_blank">国外基金版</a></div>
</footer>

<div class="watermark">FUND.CN</div>

<div class="modal-bg" id="modal">
  <div class="modal">
    <div class="modal-head">
      <div class="modal-head-left"><h2 id="mName">--</h2></div>
      <div class="modal-head-btns">
        <button class="star-btn" id="starBtn" onclick="toggleWatchlist()">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          <span id="starText">自选</span>
        </button>
        <button class="close-btn" onclick="closeModal()">×</button>
      </div>
    </div>
    <div class="modal-body" id="mBody"><div class="spinner"></div></div>
  </div>
</div>

<div class="toast" id="toast">
  <span class="toast-icon">✓</span>
  <span class="toast-msg" id="toastMsg">操作成功</span>
</div>

<script>
let fundList=[];
let watchlist=JSON.parse(localStorage.getItem('fund_watchlist')||'[]');
let currentFund={code:'',name:''};
const $=s=>document.querySelector(s);

function showToast(msg,type='success'){
  const toast=$('#toast'),toastMsg=$('#toastMsg');
  toast.className='toast '+type;
  toastMsg.textContent=msg;
  toast.classList.add('show');
  setTimeout(()=>toast.classList.remove('show'),2000);
}
const colors=['#f0b90b','#2962ff','#0ecb81','#f6465d','#8b5cf6','#06b6d4','#ec4899','#f97316','#6366f1','#14b8a6'];

document.addEventListener('DOMContentLoaded',async()=>{
  updateClock();setInterval(updateClock,1000);
  try{fundList=await(await fetch('/api/fund-list')).json()}catch(e){}
  loadTicker();loadEstRanking('up');loadRanking('up');renderWatchlist();
  setInterval(loadTicker,30000);
  setInterval(()=>loadEstRanking(document.querySelector('[data-type^="est-"].active')?.dataset.type?.replace('est-','')||'up'),30000);
  setInterval(()=>loadRanking(document.querySelector('#navTabs .tab.active')?.dataset.type||'up'),60000);
  setInterval(updateWatchlistEstimates,10000);
});

function updateClock(){$('#clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}

async function loadTicker(){
  try{
    const{indices}=await(await fetch('/api/indices')).json();
    $('#ticker').innerHTML=indices.map(i=>{
      const up=parseFloat(i.rate)>=0;
      return \`<div class="ticker-item">
        <div class="ticker-name">\${i.name}</div>
        <div class="ticker-price mono \${up?'up':'down'}">\${i.current}</div>
        <div class="ticker-change mono \${up?'up':'down'}">\${up?'+':''}\${i.change} (\${up?'+':''}\${i.rate}%)</div>
      </div>\`;
    }).join('');
  }catch(e){}
}

async function loadEstRanking(type){
  document.querySelectorAll('[data-type^="est-"]').forEach(t=>t.classList.toggle('active',t.dataset.type==='est-'+type));
  $('#estRanking').innerHTML='<div class="spinner"></div>';
  try{
    const{ranking}=await(await fetch(\`/api/ranking/estimate?type=\${type}&limit=15\`)).json();
    $('#estRanking').innerHTML=ranking.map(f=>{
      const up=f.estimateChange>=0;
      return \`<div class="list-row" onclick="openFund('\${f.code}','\${f.name.replace(/'/g,"\\\\'")}')">
        <div><div class="fund-name">\${f.name}</div><div class="fund-code mono">\${f.code}</div></div>
        <div class="fund-nav mono">\${f.estimate}</div>
        <div class="fund-chg mono \${up?'up':'down'}">\${up?'+':''}\${f.estimateChange.toFixed(2)}%</div>
      </div>\`;
    }).join('');
  }catch(e){$('#estRanking').innerHTML='<div class="empty">加载失败</div>'}
}

async function loadRanking(type){
  document.querySelectorAll('#navTabs .tab').forEach(t=>t.classList.toggle('active',t.dataset.type===type));
  $('#ranking').innerHTML='<div class="spinner"></div>';
  try{
    const{ranking}=await(await fetch(\`/api/ranking?type=\${type}&limit=15\`)).json();
    $('#ranking').innerHTML=ranking.map(f=>{
      const up=f.dayChange>=0;
      return \`<div class="list-row" onclick="openFund('\${f.code}','\${f.name.replace(/'/g,"\\\\'")}')">
        <div><div class="fund-name">\${f.name}</div><div class="fund-code mono">\${f.code}</div></div>
        <div class="fund-nav mono">\${f.netValue}</div>
        <div class="fund-chg mono \${up?'up':'down'}">\${up?'+':''}\${f.dayChange.toFixed(2)}%</div>
      </div>\`;
    }).join('');
  }catch(e){$('#ranking').innerHTML='<div class="empty">加载失败</div>'}
}

document.querySelectorAll('[data-type^="est-"]').forEach(t=>t.addEventListener('click',()=>loadEstRanking(t.dataset.type.replace('est-',''))));
document.querySelectorAll('#navTabs .tab').forEach(t=>t.addEventListener('click',()=>loadRanking(t.dataset.type)));

function saveWatchlist(){localStorage.setItem('fund_watchlist',JSON.stringify(watchlist))}
function isInWatchlist(code){return watchlist.some(w=>w.code===code)}
function toggleWatchlist(){
  if(!currentFund.code)return;
  const wasInList=isInWatchlist(currentFund.code);
  if(wasInList){
    watchlist=watchlist.filter(w=>w.code!==currentFund.code);
    showToast('已移除自选','warning');
  }else{
    watchlist.unshift({code:currentFund.code,name:currentFund.name,estimateChange:null,estimateTime:null});
    showToast('已添加自选','success');
  }
  saveWatchlist();renderWatchlist();updateStarBtn();
}
function updateStarBtn(){
  const inList=isInWatchlist(currentFund.code);
  $('#starBtn').classList.toggle('active',inList);
  $('#starText').textContent=inList?'已自选':'自选';
}
function removeFromWatchlist(code,e){
  e.stopPropagation();
  watchlist=watchlist.filter(w=>w.code!==code);
  saveWatchlist();renderWatchlist();
}

function renderWatchlist(){
  $('#watchCount').textContent=watchlist.length+'只';
  if(!watchlist.length){$('#watchlist').innerHTML='<div class="empty">点击基金详情右上角添加自选</div>';return}
  $('#watchlist').innerHTML=watchlist.map(w=>{
    const hasEst=w.estimateChange!==null;
    const up=hasEst&&parseFloat(w.estimateChange)>=0;
    return \`<div class="watch-row" onclick="openFund('\${w.code}','\${w.name.replace(/'/g,"\\\\'")}')">
      <div class="watch-info">
        <div class="fund-name">\${w.name}</div>
        <div class="fund-code mono">\${w.code}</div>
      </div>
      <div class="watch-est">
        <div class="watch-est-val mono \${up?'up':'down'}">\${hasEst?(up?'+':'')+w.estimateChange+'%':'--'}</div>
        <div class="watch-est-time">\${w.estimateTime||''}</div>
      </div>
      <button class="fund-remove" onclick="removeFromWatchlist('\${w.code}',event)">×</button>
    </div>\`;
  }).join('');
}

async function updateWatchlistEstimates(){
  if(!watchlist.length)return;
  for(let w of watchlist){
    try{
      const res=await fetch(\`/api/fund/estimate?code=\${w.code}\`);
      const data=await res.json();
      if(data.estimateChange!==undefined){
        w.estimateChange=data.estimateChange;
        w.estimateTime=data.estimateTime?.split(' ')[1]||'';
      }
    }catch(e){}
  }
  renderWatchlist();
}

const searchInput=$('#searchInput'),dropdown=$('#dropdown');
let debounce;
searchInput.addEventListener('input',e=>{clearTimeout(debounce);debounce=setTimeout(()=>doSearch(e.target.value),150)});
function doSearch(kw){
  if(!kw.trim()){dropdown.classList.remove('show');return}
  const lower=kw.toLowerCase();
  const results=fundList.filter(f=>f.code.includes(kw)||f.name.toLowerCase().includes(lower)||f.pinyin.toLowerCase().includes(lower)).slice(0,12);
  if(results.length){
    dropdown.innerHTML=results.map(f=>\`
      <div class="dd-item" onclick="openFund('\${f.code}','\${f.name.replace(/'/g,"\\\\'")}')">
        <div><span class="dd-code mono">\${f.code}</span>\${f.name}</div>
        <span style="color:var(--text3);font-size:11px">\${f.type||''}</span>
      </div>
    \`).join('');
    dropdown.classList.add('show');
  }else{dropdown.innerHTML='<div class="empty">无结果</div>';dropdown.classList.add('show')}
}
document.addEventListener('click',e=>{if(!e.target.closest('.search'))dropdown.classList.remove('show')});

async function openFund(code,name){
  currentFund={code,name};
  dropdown.classList.remove('show');searchInput.value='';
  $('#mName').innerHTML=name+'<span>'+code+'</span>';
  $('#mBody').innerHTML='<div class="spinner"></div>';
  updateStarBtn();
  $('#modal').classList.add('open');
  try{
    const[est,{detail},{stocks,updateDate},{performance}]=await Promise.all([
      (await fetch(\`/api/fund/estimate?code=\${code}\`)).json(),
      (await fetch(\`/api/fund/\${code}/detail\`)).json(),
      (await fetch(\`/api/fund/\${code}/portfolio\`)).json(),
      (await fetch(\`/api/fund/\${code}/performance\`)).json()
    ]);
    renderModal(est,detail,stocks,updateDate,performance);
  }catch(e){$('#mBody').innerHTML='<div class="empty">加载失败</div>'}
}

function renderModal(est,detail,stocks,updateDate,performance){
  const hasEst=est&&est.estimateChange!==undefined;
  const chg=hasEst?parseFloat(est.estimateChange):0;
  const up=chg>=0;
  const perfKeys=['Z','Y','3Y','1N','LN'];
  const perfLabels={Z:'近1周',Y:'近1月','3Y':'近3月','1N':'近1年',LN:'成立来'};
  const perfHtml=performance?.filter(p=>perfKeys.includes(p.period)).map(p=>{
    const v=p.value,isUp=v>=0;
    return \`<div class="perf-item"><div class="perf-label">\${perfLabels[p.period]||p.label}</div><div class="perf-val mono \${isUp?'up':'down'}">\${isUp?'+':''}\${v.toFixed(2)}%</div></div>\`;
  }).join('')||'';
  let chartHtml='',stocksHtml='';
  if(stocks?.length){
    chartHtml='<div class="chart-bar">'+stocks.slice(0,10).map((s,i)=>\`<div class="chart-seg" style="width:\${s.percent}%;background:\${colors[i%10]}"></div>\`).join('')+'</div>';
    stocksHtml='<div class="stock-list">'+stocks.slice(0,10).map((s,i)=>\`<div class="stock-row"><div style="display:flex;align-items:center"><div class="stock-dot" style="background:\${colors[i%10]}"></div>\${s.name}</div><div class="stock-pct mono">\${s.percent.toFixed(2)}%</div></div>\`).join('')+'</div>';
  }else{stocksHtml='<div class="empty">暂无持仓数据</div>'}
  $('#mBody').innerHTML=\`
    <div class="est-row">
      <div class="est-val mono \${up?'up':'down'}">\${hasEst?(up?'+':'')+est.estimateChange+'%':'--'}</div>
      <div class="est-time">\${hasEst?est.estimateTime+' 估值':'暂无估值'}</div>
    </div>
    <div class="info-title">阶段收益</div>
    <div class="perf-row">\${perfHtml||'<div style="color:var(--text3)">暂无数据</div>'}</div>
    <div class="info-title">基金信息</div>
    <div class="info-grid">
      <div class="info-item"><dt>单位净值</dt><dd class="mono">\${detail?.netValue||est?.netValue||'--'}</dd></div>
      <div class="info-item"><dt>基金规模</dt><dd>\${detail?.scale||'--'}</dd></div>
      <div class="info-item"><dt>基金公司</dt><dd>\${detail?.company||'--'}</dd></div>
      <div class="info-item"><dt>基金经理</dt><dd>\${detail?.manager||'--'}</dd></div>
      <div class="info-item"><dt>成立日期</dt><dd>\${detail?.establishDate||'--'}</dd></div>
      <div class="info-item"><dt>管理费率</dt><dd>\${detail?.manageFee||'--'}</dd></div>
    </div>
    <div class="info-title">持仓分布 TOP10 \${updateDate?'('+updateDate+')':''}</div>
    \${chartHtml}\${stocksHtml}
  \`;
}

function closeModal(){$('#modal').classList.remove('open');currentFund={code:'',name:''}}
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal()});
</script>
</body>
</html>`;
  return new Response(html,{headers:{'Content-Type':'text/html;charset=UTF-8',...corsHeaders}})
}
