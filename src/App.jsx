import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchCurrent, fetchVolumes30d, fetchMakerTVL } from './api';
import {
  pdScore, lsScore, crScore, tiScore, rrScore,
  srhsTotal, getGrade, scoreColor,
  CR_BASELINE,
} from './scoring';
import './index.css';

const REFRESH_MS = 45_000;   // 45초 (CoinGecko 무료 rate limit 대응)
const HISTORY_MS = 60 * 60 * 1000;

// ── 브라우저 알림 ────────────────────────────────────────────────────────
function sendCriticalNotif(symbols) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification('🔴 SRHS 즉시 교체 권고', {
    body: `${symbols.join(', ')} 위험점수 76점 초과 — 즉시 교체 검토 필요`,
    tag: 'srhs-critical',
    requireInteraction: true,
  });
}

const COIN_INFO = {
  USDT:  { name: '테더',      issuer: 'Tether Ltd.', country: '홍콩',     emoji: '🟡', desc: '세계 최대 스테이블코인(시총 약 1,100억 달러). 홍콩 소재 발행사 Tether가 운영하며 CARF 미가입국 소재로 한국 과세당국의 추적이 불가능합니다. 준비금 62%로 완전 담보에 미달하며 분기 1회 일부 공개로 투명성이 낮습니다.' },
  USDC:  { name: 'USD코인',   issuer: 'Circle',      country: '미국',     emoji: '🔵', desc: '미국 Circle이 발행하는 규제 준수 스테이블코인. 매주 Grant Thornton의 제3자 감사 보고서를 공개하며, 준비금 92%(달러·단기채권)로 안정성이 높습니다. CARF·FATCA·CRS 모두 준수하여 B2B 결제 리스크가 가장 낮습니다.' },
  DAI:   { name: '다이',      issuer: 'MakerDAO',    country: '탈중앙화', emoji: '🟠', desc: '발행사가 없는 탈중앙화 스테이블코인. 이더리움 등 암호화폐를 담보로 스마트컨트랙트가 자동 발행·소각합니다. 담보비율이 DeFiLlama에서 실시간 공개되며 현재 140%로 초과 담보 상태입니다. 단, 법적 관할권이 불명확하다는 규제 불확실성이 존재합니다.' },
  PYUSD: { name: '페이팔USD', issuer: 'PayPal',      country: '미국',     emoji: '🟣', desc: '간편결제 플랫폼 PayPal이 2023년 직접 발행한 스테이블코인. 미국 규제 하에 운영되며 분기별 준비금 공시(78%)를 제공합니다. USDC 대비 투명성·준비금이 다소 낮지만, 미국 기반으로 규제 리스크는 낮은 편입니다.' },
};

const METRIC_INFO = {
  PD: {
    full: '달러 이탈 (Price Deviation)',
    desc: '스테이블코인이 1달러($1.000)에서 얼마나 벗어났는지를 실시간으로 측정합니다. 계산식은 |현재가 − $1| ÷ 0.02 × 100이며, 이탈률이 0.5% 이상이면 주황 경고, 2% 이상이면 위험점수 100점 만점(CRITICAL)이 됩니다. 스테이블코인의 가장 기본적인 건전성 지표입니다.',
    detail: '실전 예시: 시세가 $0.980이면 이탈률 2.0% → 위험점수 100점. 수출기업이 $100,000 무역대금을 USDT로 수취하는 순간 이미 $2,000의 환차손이 확정됩니다. 실시간으로 갱신되므로 결제 직전에 꼭 확인하세요.',
    src: 'CoinGecko /coins/markets · 45초 자동 갱신 (무료 플랜)',
  },
  LS: {
    full: '유동성 신호 (Liquidity Signal)',
    desc: '24시간 거래량이 30일 평균 대비 얼마나 급등했는지 Z-score(표준편차 기준)로 측정합니다. Z-score = (오늘 거래량 − 30일 평균) ÷ 표준편차. 값이 높을수록 "비정상적 매도 폭풍"이 발생했다는 의미로, 패닉셀 또는 뱅크런 전조 신호일 수 있습니다.',
    detail: '실전 예시: Z-score가 3을 넘으면 위험점수 100점. 2022년 USDC 탈페깅 사태 당시 거래량이 Z-score 4.8을 기록했습니다. 결제 실행 시점에 슬리피지(주문과 체결가 차이)가 0.3~0.8%까지 급증해 실질 환율 손실이 발생합니다.',
    src: 'CoinGecko /coins/{id}/market_chart?days=30 · 시계열 1시간 캐시',
  },
  CR: {
    full: '준비금 충분성 (Collateral Ratio)',
    desc: '발행된 코인 총 시가총액 대비 실제 보유 준비금(현금·국채·단기채권 등)이 얼마나 확보됐는지 비율로 나타냅니다. 100% 미만이면 부분 담보로 뱅크런 위험이 있으며, 200% 이상이어야 "완전 안전" 등급입니다. DAI는 실시간 온체인 데이터로, 나머지는 발행사 공시값으로 계산합니다.',
    detail: '실전 예시: USDT 준비금 62% → 100달러 어치 코인에 실제 담보는 62달러. 대규모 동시 환매(뱅크런) 시 38달러는 회수 불가. 반면 DAI는 140% 초과담보로 원금 회수 가능성이 높습니다. 단, DAI는 담보가 암호화폐여서 시장 폭락 시 담보가치도 동시에 하락하는 리스크가 있습니다.',
    src: 'DAI: DeFiLlama /protocol/makerdao TVL ÷ 유통량 실시간 계산 / USDT(62%)·USDC(92%)·PYUSD(78%): 발행사 최신 공시 기준',
  },
  TI: {
    full: '공시 투명성 (Transparency Index)',
    desc: '발행사가 준비금 구성(현금·채권·기타 자산 비율)을 얼마나 자주, 얼마나 상세하게, 제3자 감사를 통해 공개하는지를 0~100 척도로 평가합니다. 투명성이 높을수록 CR 수치의 신뢰도가 높아집니다. BIS WP#1164 및 S&P Global 스테이블코인 투명성 기준을 참고하여 연구팀이 정성 평가했습니다.',
    detail: '실전 예시: USDC는 Circle이 매주 Grant Thornton의 독립 감사 보고서를 공개 → TI 원점수 94점 → 위험점수 6점(LOW). USDT는 분기 1회 요약만 공개, 독립 감사 없음 → 원점수 44점 → 위험점수 56점(HIGH). 불투명한 준비금 공시는 실제 담보 가치 파악 자체를 불가능하게 만듭니다.',
    src: 'BIS Working Paper #1164 · S&P Global 기준 · 연구팀 정성 평가 · 담당: 이민우',
  },
  RR: {
    full: '규제 위험 (Regulatory Risk)',
    desc: '한국 외국환거래법(제18조 자본거래 신고 의무), CARF MCAA(암호화폐 과세정보 자동교환협약, 2024.11 서명) 기준으로 해당 코인을 B2B 무역결제에 사용할 때 발생할 수 있는 법적 리스크를 0~100 점수화합니다. 발행사 소재국의 CARF 가입 여부, 규제 이력, 법인 구조를 종합 평가합니다.',
    detail: '실전 예시: USDT 발행사 Tether는 홍콩 소재로 CARF 비가입국 → 한국 국세청이 과세 정보를 받을 수 없음 → 외국환거래법 제18조 신고 위반 시 3년 이하 징역 또는 3억 이하 벌금 리스크. 반면 USDC는 미국 규제·FATCA·CARF 모두 준수 → 위험점수 14점(LOW)으로 가장 안전합니다.',
    src: '외국환거래법 제18조 · FATCA · OECD CRS · CARF MCAA(2024.11.27) · 법령 기반 고정값 · 담당: 송승민',
  },
};

// 코인별 고정 점수 근거 (CR·TI·RR는 정책 기반 고정값)
const COIN_SCORE_REASON = {
  USDT: {
    summary: '준비금 부족(CR) + 공시 불투명(TI) + 규제 위험(RR) 세 항목이 모두 높아 총점이 올라갑니다.',
    items: [
      { metric: 'CR', fixed: true,  icon: '🔴', title: '준비금 62% — 뱅크런 위험',        body: '100달러 발행에 실제 담보는 62달러. 대규모 환매 요청 시 38달러는 회수 불가. 2021년 CFTC·NYAG 제재 이후에도 준비금 구성(상업어음 비율)이 논란 중입니다.' },
      { metric: 'TI', fixed: true,  icon: '🔴', title: '투명성 원점수 44점 — 불투명',     body: '분기 1회 요약 공시, 독립 감사 없음. 어떤 자산이 얼마만큼 담보인지 외부에서 확인이 불가능합니다. BIS 기준 최하위 등급입니다.' },
      { metric: 'RR', fixed: true,  icon: '🔴', title: '홍콩 소재 · CARF 비가입 — 추적 불가', body: '발행사 Tether가 홍콩 BVI 소재. 홍콩은 CARF 미가입국으로 한국 국세청이 과세 정보를 요청해도 응할 의무가 없습니다. 외국환거래법 제18조 신고 위반 시 형사처벌 가능성이 있습니다.' },
      { metric: 'PD', fixed: false, icon: '✅', title: '시세 이탈 거의 없음 — 실시간 변동', body: '시총 1위 코인답게 시세 안정성은 높습니다. 그러나 이탈이 생겼을 때의 충격은 유통량이 가장 많아 시장 전체에 파급됩니다.' },
      { metric: 'LS', fixed: false, icon: '✅', title: '거래량 Z-score — 실시간 변동',      body: '일반적으로 정상 범위. 그러나 글로벌 시장에서 USDT 대규모 매도가 발생하면 Z-score가 급등할 수 있어 주의가 필요합니다.' },
    ],
  },
  USDC: {
    summary: '준비금·투명성·규제 모두 최고 수준. PD·LS가 정상이면 전체 점수가 가장 낮습니다.',
    items: [
      { metric: 'CR', fixed: true,  icon: '🟡', title: '준비금 92% — 달러·국채 담보',      body: '92% 준비금 중 대부분이 현금과 미국 단기채권(T-Bills)으로 구성. 뱅크런 발생 시도 대부분 회수 가능. 8%는 기타 자산으로 소폭 위험이 남습니다.' },
      { metric: 'TI', fixed: true,  icon: '✅', title: '투명성 원점수 94점 — 업계 최고',   body: 'Circle이 매주 Grant Thornton의 독립 감사 보고서를 공개합니다. 준비금의 자산별 구성(현금/채권/비율)을 외부에서 완전 검증 가능한 유일한 코인입니다.' },
      { metric: 'RR', fixed: true,  icon: '✅', title: '미국 규제 · CARF 가입 — 최저 리스크', body: '미국 금융당국(FinCEN) 라이선스 보유, FATCA·CRS·CARF 모두 준수. 한국 과세당국이 거래 내역 정보를 공식 요청할 수 있어 법적 분쟁 리스크가 가장 낮습니다.' },
      { metric: 'PD', fixed: false, icon: '✅', title: '시세 이탈 거의 없음 — 실시간 변동', body: '2023년 SVB 사태 당시 일시적으로 $0.88까지 탈페깅됐으나 이틀 내 회복. 이 경험으로 USDC는 미국 규제 기반 준비금 구조를 더 강화했습니다.' },
      { metric: 'LS', fixed: false, icon: '✅', title: '거래량 Z-score — 실시간 변동',      body: '일반적으로 정상 범위. SVB 사태처럼 발행사 관련 뉴스가 터지면 Z-score가 순간 급등하므로 실시간 모니터링이 필요합니다.' },
    ],
  },
  DAI: {
    summary: '초과담보(CR 140%)와 온체인 투명성이 강점이지만, 담보가 암호화폐여서 시장 폭락 시 동반 위험이 있습니다.',
    items: [
      { metric: 'CR', fixed: false, icon: '✅', title: '담보비율 140% — 실시간 초과 담보', body: 'DeFiLlama에서 MakerDAO TVL ÷ DAI 유통량을 실시간 계산. 현재 140%로 담보가 충분합니다. 단, 담보가 ETH·BTC 등 암호화폐여서 시장 폭락 시 담보 가치와 DAI 가치가 동시에 흔들릴 수 있습니다.' },
      { metric: 'TI', fixed: true,  icon: '✅', title: '온체인 완전 공개 — 스마트컨트랙트 검증', body: '발행사가 없어 공시 의무 자체가 없지만, 모든 담보 내역이 이더리움 블록체인에 실시간 공개됩니다. 누구나 MakerDAO 스마트컨트랙트를 통해 담보 구성을 검증할 수 있어 사실상 완전 투명합니다.' },
      { metric: 'RR', fixed: true,  icon: '🟡', title: '탈중앙화 · 법적 관할권 불명확',    body: '발행사가 없어 CARF 적용 대상이 불명확합니다. DAO 투표로 운영되어 법적 책임 주체가 없습니다. 한국 외국환거래법상 "발행 기관"에 해당하지 않아 신고 절차가 모호합니다.' },
      { metric: 'PD', fixed: false, icon: '🟡', title: '시세 이탈 주의 — 실시간 변동',     body: '알고리즘 기반이어서 ETH 가격이 급락하면 DAI도 순간 탈페깅될 수 있습니다. 2020년 "블랙 서스데이" 당시 $0.94까지 탈페깅된 사례가 있어 실시간 모니터링이 중요합니다.' },
      { metric: 'LS', fixed: false, icon: '✅', title: '거래량 Z-score — 실시간 변동',      body: 'DeFi 생태계 전체 위기 시 DAI 거래량이 급증하는 패턴이 있습니다. 다른 DeFi 코인 폭락 뉴스가 나오면 연동 위험을 주시해야 합니다.' },
    ],
  },
  PYUSD: {
    summary: '미국 규제(RR 낮음)는 강점이지만, USDC 대비 준비금·투명성이 낮아 중간 점수대입니다.',
    items: [
      { metric: 'CR', fixed: true,  icon: '🟡', title: '준비금 78% — USDC보단 낮음',       body: 'PayPal이 공시한 준비금 78%. 100달러 발행에 22달러는 담보 미달. USDC(92%)보다 낮고 USDT(62%)보다는 높습니다. 2024년 출시 초기라 준비금 구성의 변동성이 아직 큰 편입니다.' },
      { metric: 'TI', fixed: true,  icon: '🟡', title: '투명성 분기 공개 — 중간 수준',     body: 'PayPal이 분기별로 준비금 내역을 공개하지만, USDC처럼 매주 독립 감사 보고서를 제공하지는 않습니다. 공시 빈도와 세부 내역이 USDC 대비 부족합니다.' },
      { metric: 'RR', fixed: true,  icon: '✅', title: '미국 기반 · CARF 준수',             body: 'PayPal은 미국 상장사로 FinCEN 라이선스를 보유하며, CARF·FATCA 준수. 한국에서 법적 추적이 가능하고 외국환거래법상 신고 리스크가 낮습니다. 다만 PayPal 자체의 규제 리스크(반독점·소비자보호법)가 잠재적으로 존재합니다.' },
      { metric: 'PD', fixed: false, icon: '✅', title: '시세 이탈 거의 없음 — 실시간 변동', body: 'PayPal의 결제 인프라와 연동되어 시세 안정성은 높습니다. 그러나 거래 유동성이 USDT·USDC 대비 낮아 급락 시 회복이 느릴 수 있습니다.' },
      { metric: 'LS', fixed: false, icon: '✅', title: '거래량 Z-score — 실시간 변동',      body: '유통량이 상대적으로 적어 대규모 거래 하나로 Z-score가 순간 급등할 수 있습니다. 소규모 시장이므로 슬리피지 위험에 더 주의가 필요합니다.' },
    ],
  },
};

const GRADE_META = {
  LOW:      { bg: '#ECFDF5', text: '#00B87A', label: '정상',   emoji: '✅' },
  CAUTION:  { bg: '#FFFBEB', text: '#F59E0B', label: '주의',   emoji: '⚠️' },
  HIGH:     { bg: '#FFF7ED', text: '#F97316', label: '위험',   emoji: '🔶' },
  CRITICAL: { bg: '#FEF2F2', text: '#EF4444', label: '즉시교체', emoji: '🔴' },
};

// ── 스파크라인 ───────────────────────────────────────────────────────
function Sparkline({ data, color, width = 72, height = 26 }) {
  if (!data || data.length < 2) return (
    <span style={{ fontSize: 10, color: 'var(--text3)' }}>수집 중…</span>
  );
  const min = Math.min(...data);
  const max = Math.max(...data, min + 0.5);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / (max - min + 0.001)) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const arrow = last > prev + 0.5 ? '▲' : last < prev - 0.5 ? '▼' : '—';
  const arrowCol = last > prev + 0.5 ? 'var(--red)' : last < prev - 0.5 ? 'var(--green)' : 'var(--text3)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ flexShrink: 0 }}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8}
          strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
        <circle cx={pts.split(' ').at(-1).split(',')[0]} cy={pts.split(' ').at(-1).split(',')[1]}
          r={2.5} fill={color} />
      </svg>
      <span style={{ fontSize: 11, fontWeight: 800, color: arrowCol }}>{arrow}</span>
    </div>
  );
}

// ── 지표 바 (라이트 버전) ────────────────────────────────────────────────
function MetricBar({ label, score }) {
  const color = scoreColor(score);
  const bgMap = { 'var(--green)': '#ECFDF5', 'var(--yellow)': '#FFFBEB', 'var(--orange)': '#FFF7ED', 'var(--red)': '#FEF2F2' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
      <span style={{ width: 28, fontSize: 11, fontWeight: 800, color: 'var(--text3)', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 10, background: bgMap[color] ?? '#F0F3FA', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{
          width: `${score}%`, height: '100%', background: color, borderRadius: 5,
          transition: 'width 0.7s cubic-bezier(.4,0,.2,1)',
        }} />
      </div>
      <span style={{ width: 38, textAlign: 'right', fontSize: 13, fontWeight: 900, color, flexShrink: 0 }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

// ── 원형 게이지 ─────────────────────────────────────────────────────────
function CircleGauge({ score, color }) {
  const r = 48, cx = 56, cy = 56;
  const circ = 2 * Math.PI * r;
  const dash  = (score / 100) * circ * 0.75;
  const gap   = circ - dash;
  const offset = circ * 0.125;

  return (
    <svg width={112} height={96} viewBox="0 0 112 104">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E8EDF5"
        strokeWidth={9} strokeDasharray={`${circ * 0.75} ${circ * 0.25}`}
        strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(135 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color}
        strokeWidth={9} strokeDasharray={`${dash} ${gap + circ * 0.25}`}
        strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(135 ${cx} ${cy})`}
        style={{ transition: 'stroke-dasharray 0.8s ease, stroke 0.4s' }} />
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize={24} fontWeight={900}
        fill={color} fontFamily="inherit">{Math.round(score)}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={10} fontWeight={700}
        fill="var(--text3)" fontFamily="inherit">/ 100점</text>
    </svg>
  );
}

// ── 코인 카드 ────────────────────────────────────────────────────────────
function CoinCard({ sym, data, expanded, onToggle }) {
  const { srhs, breakdown, price, crRatio, zScore } = data;
  const info     = COIN_INFO[sym];
  const gradeInfo = getGrade(srhs);
  const gm       = GRADE_META[gradeInfo.label];
  const crPct    = crRatio * 100;
  const crCol    = crPct >= 100 ? 'var(--green)' : crPct >= 70 ? 'var(--yellow)' : 'var(--red)';
  const pd       = Math.abs(price - 1.0) * 100;

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow)',
      overflow: 'hidden',
      transition: 'box-shadow 0.2s, transform 0.2s',
      border: '1px solid var(--border)',
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-hover)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow)'}
    >
      {/* 상단 컬러 스트라이프 */}
      <div style={{ height: 4, background: gradeInfo.color }} />

      {/* 헤더 영역 */}
      <button onClick={onToggle} style={{
        width: '100%', padding: '18px 20px 14px',
        display: 'flex', alignItems: 'flex-start', gap: 14, textAlign: 'left',
      }}>
        {/* 왼쪽: 코인 정보 */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 20 }}>{info.emoji}</span>
            <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.5, color: 'var(--text1)' }}>{sym}</span>
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800,
              background: gm.bg, color: gm.text,
            }}>{gm.emoji} {gm.label}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 2 }}>
            {info.name} · {info.issuer} · {info.country}
          </div>
          <div style={{ fontSize: 12, color: gm.text, fontWeight: 700 }}>
            {gradeInfo.text}
          </div>
        </div>

        {/* 오른쪽 수치 3개 */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexShrink: 0 }}>
          <ChipStat label="현재 시세" value={`$${price.toFixed(5)}`}
            sub={pd >= 0.5 ? `⚠️ ${pd.toFixed(3)}% 이탈` : '안정'}
            subColor={pd >= 0.5 ? 'var(--red)' : 'var(--green)'} />
          <ChipStat label="준비금" value={`${crPct.toFixed(0)}%`} valueColor={crCol} />
          <ChipStat label="SRHS" value={`${srhs.toFixed(1)}`} unit="점"
            valueColor={gradeInfo.color} big />
        </div>
      </button>

      {/* 게이지 + 바 */}
      <div style={{
        padding: '0 20px 18px',
        display: 'flex', gap: 16, alignItems: 'flex-start',
        background: '#FAFBFF',
        borderTop: '1px solid var(--border)',
        borderBottom: expanded ? '1px solid var(--border)' : 'none',
      }}>
        <div style={{ flexShrink: 0, paddingTop: 14 }}>
          <CircleGauge score={srhs} color={gradeInfo.color} />
        </div>
        <div style={{ flex: 1, paddingTop: 18 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10, fontWeight: 800,
                        textTransform: 'uppercase', letterSpacing: 1 }}>
            항목별 위험점수 · 높을수록 위험
          </div>
          {Object.entries(breakdown).map(([k, v]) => (
            <MetricBar key={k} label={k} score={v} />
          ))}
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)' }}>
            유동성 Z-score:&nbsp;
            <span style={{ fontWeight: 800, color: 'var(--text2)' }}>{zScore.toFixed(3)}</span>
          </div>
        </div>
      </div>

      {/* 상세 설명 */}
      {expanded && (
        <div style={{ padding: '16px 20px', animation: 'slideDown 0.2s ease' }}>
          <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.75, marginBottom: 14 }}>
            {info.desc}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {Object.entries(breakdown).map(([k, v]) => {
              const mi = METRIC_INFO[k];
              const c  = scoreColor(v);
              return (
                <div key={k} style={{
                  background: 'var(--surface2)', borderRadius: 12, padding: '12px 14px',
                  border: `1.5px solid ${c}22`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: c }}>{k} — {mi.full}</span>
                    <span style={{ fontSize: 13, fontWeight: 900, color: c }}>{v.toFixed(1)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6 }}>{mi.desc}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>📌 {mi.src}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 더보기 토글 */}
      <button onClick={onToggle} style={{
        width: '100%', padding: '11px', fontSize: 12, fontWeight: 700,
        color: 'var(--text3)', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        background: 'var(--surface)',
      }}>
        {expanded ? '▲ 닫기' : '▼ 지표 상세 보기'}
      </button>
    </div>
  );
}

function ChipStat({ label, value, unit, sub, valueColor, subColor, big }) {
  return (
    <div style={{ textAlign: 'center', minWidth: big ? 64 : 52 }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        fontSize: big ? 24 : 15, fontWeight: 900,
        color: valueColor ?? 'var(--text1)', letterSpacing: -0.5,
        lineHeight: 1,
      }}>
        {value}{unit && <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 2 }}>{unit}</span>}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: subColor ?? 'var(--text3)', marginTop: 3, fontWeight: 700 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── 비교 테이블 ─────────────────────────────────────────────────────────
function CompareTable({ results }) {
  const order = Object.keys(results).sort((a, b) => results[b].srhs - results[a].srhs);
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow)', border: '1px solid var(--border)', overflow: 'hidden',
    }}>
      <div style={{ padding: '18px 22px 12px', fontWeight: 900, fontSize: 16, color: 'var(--text1)' }}>
        📊 전체 비교
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['코인', 'SRHS', '등급', 'PD', 'LS', 'CR', 'TI', 'RR', '현재가', '준비금'].map(h => (
                <th key={h} style={{
                  padding: '10px 16px', textAlign: h === '코인' ? 'left' : 'center',
                  color: 'var(--text3)', fontWeight: 800, whiteSpace: 'nowrap',
                  borderBottom: '1px solid var(--border)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((sym, i) => {
              const r  = results[sym];
              const g  = getGrade(r.srhs);
              const gm = GRADE_META[g.label];
              return (
                <tr key={sym} style={{
                  borderBottom: '1px solid var(--border)',
                  background: i % 2 === 0 ? 'transparent' : 'var(--surface2)',
                }}>
                  <td style={{ padding: '13px 16px', fontWeight: 800 }}>
                    {COIN_INFO[sym].emoji} {sym}
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'center', fontWeight: 900, color: g.color }}>
                    {r.srhs.toFixed(1)}
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'center' }}>
                    <span style={{
                      padding: '3px 10px', borderRadius: 20, fontSize: 11,
                      fontWeight: 800, background: gm.bg, color: gm.text,
                    }}>{gm.emoji} {gm.label}</span>
                  </td>
                  {['PD','LS','CR','TI','RR'].map(k => (
                    <td key={k} style={{
                      padding: '13px 16px', textAlign: 'center',
                      fontWeight: 800, color: scoreColor(r.breakdown[k]),
                    }}>
                      {r.breakdown[k].toFixed(1)}
                    </td>
                  ))}
                  <td style={{ padding: '13px 16px', textAlign: 'center', color: 'var(--text2)', fontSize: 12 }}>
                    ${r.price.toFixed(5)}
                  </td>
                  <td style={{ padding: '13px 16px', textAlign: 'center', fontWeight: 800,
                    color: r.crRatio * 100 >= 100 ? 'var(--green)' : r.crRatio * 100 >= 70 ? 'var(--yellow)' : 'var(--red)' }}>
                    {(r.crRatio * 100).toFixed(0)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 레이더 차트 (5각형 메트릭) ────────────────────────────────────────
const COIN_COLORS = { USDC: '#3B82F6', DAI: '#F97316', PYUSD: '#8B5CF6', USDT: '#F59E0B' };

function RadarChart({ results }) {
  if (!results) return null;
  const metrics = ['PD', 'LS', 'CR', 'TI', 'RR'];
  // 레이블: 코드 + 한글 2줄 (별도 foreignObject 대신 SVG 2줄 text)
  const metricLines = {
    PD: ['PD', '달러이탈'],
    LS: ['LS', '유동성'],
    CR: ['CR', '준비금'],
    TI: ['TI', '투명성'],
    RR: ['RR', '규제위험'],
  };
  const n = metrics.length;
  // viewBox를 넉넉하게: cx=150, cy=155, R=90 → 라벨 여백 확보
  const cx = 150, cy = 155, R = 90;
  const W = 300, H = 310;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  const gridPolygon = (ratio) =>
    metrics.map((_, i) => {
      const a = startAngle + i * angleStep;
      return `${(cx + R * ratio * Math.cos(a)).toFixed(1)},${(cy + R * ratio * Math.sin(a)).toFixed(1)}`;
    }).join(' ');

  const coinPolygon = (_sym, data) =>
    metrics.map((m, i) => {
      const score = data.breakdown[m] / 100;
      const a = startAngle + i * angleStep;
      return `${(cx + R * score * Math.cos(a)).toFixed(1)},${(cy + R * score * Math.sin(a)).toFixed(1)}`;
    }).join(' ');

  const sorted = Object.entries(results).sort((a, b) => a[1].srhs - b[1].srhs);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {/* 배경 그리드 */}
      {[0.25, 0.5, 0.75, 1.0].map((r, i) => (
        <polygon key={i} points={gridPolygon(r)} fill={r === 1.0 ? '#FEF2F233' : 'none'}
          stroke="#E2E8F0" strokeWidth={i === 3 ? 1.5 : 1} />
      ))}
      {/* 축선 */}
      {metrics.map((_, i) => {
        const a = startAngle + i * angleStep;
        return <line key={i} x1={cx} y1={cy}
          x2={(cx + R * Math.cos(a)).toFixed(1)}
          y2={(cy + R * Math.sin(a)).toFixed(1)}
          stroke="#D1D5DB" strokeWidth={1} />;
      })}
      {/* 코인별 폴리곤 */}
      {sorted.map(([sym, data]) => (
        <polygon key={sym} points={coinPolygon(sym, data)}
          fill={COIN_COLORS[sym] + '1A'} stroke={COIN_COLORS[sym]}
          strokeWidth={2.2} opacity={0.9} />
      ))}
      {/* 눈금 숫자 (25, 50, 75) — 맨 위 축 기준 */}
      {[25, 50, 75].map((v) => {
        const r = v / 100;
        const lx = cx + R * r * Math.cos(startAngle) + 4;
        const ly = cy + R * r * Math.sin(startAngle) - 3;
        return (
          <text key={v} x={lx.toFixed(1)} y={ly.toFixed(1)}
            textAnchor="start" fontSize={8} fill="#9CA3AF" fontFamily="inherit">{v}</text>
        );
      })}
      {/* 축 라벨 (코드 + 한글) */}
      {metrics.map((m, i) => {
        const a = startAngle + i * angleStep;
        const dist = R + 22;
        const lx = cx + dist * Math.cos(a);
        const ly = cy + dist * Math.sin(a);
        const [code, kor] = metricLines[m];
        return (
          <g key={m}>
            <text x={lx.toFixed(1)} y={(ly - 5).toFixed(1)}
              textAnchor="middle" fontSize={10} fontWeight={800}
              fill="#374151" fontFamily="inherit">{code}</text>
            <text x={lx.toFixed(1)} y={(ly + 8).toFixed(1)}
              textAnchor="middle" fontSize={8}
              fill="#9CA3AF" fontFamily="inherit">{kor}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── 메인 App ─────────────────────────────────────────────────────────────
export default function App() {
  const [results,      setResults]      = useState(null);
  const [status,       setStatus]       = useState('loading');
  const [lastUpdate,   setLastUpdate]   = useState('');
  const [expanded,     setExpanded]     = useState({});
  const [expandedRank, setExpandedRank] = useState({});
  const [activeTab,    setActiveTab]    = useState('dashboard');
  const [notifPerm,    setNotifPerm]    = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [history, setHistory] = useState({});   // { sym: [srhs, ...] } 최대 30개

  const volCache        = useRef({ data: null, ts: 0 });
  const notifiedSymbols = useRef(new Set());

  const fetchAll = useCallback(async () => {
    try {
      // 첫 로드일 때만 loading 표시 (재갱신 시엔 기존 데이터 유지)
      setStatus(prev => prev === 'ok' ? 'refreshing' : 'loading');
      const current = await fetchCurrent();

      const now = Date.now();
      if (!volCache.current.data || now - volCache.current.ts > HISTORY_MS) {
        const vols = {};
        for (const sym of Object.keys(current)) {
          vols[sym] = await fetchVolumes30d(sym);
        }
        volCache.current = { data: vols, ts: now };
      }
      const volumes = volCache.current.data;

      let makerTVL = 0;
      try { makerTVL = await fetchMakerTVL(); } catch {}

      const computed = {};
      for (const sym of Object.keys(current)) {
        const { price, volume24h, supply } = current[sym];
        const vols30d = volumes[sym] ?? [];

        const pd = pdScore(price);
        const ls = lsScore(volume24h, vols30d);

        let crRatio;
        if (sym === 'DAI') {
          crRatio = supply > 0 ? makerTVL / supply : 1.55;
        } else {
          crRatio = CR_BASELINE[sym] ?? 1.0;
        }

        const cr  = crScore(crRatio);
        const ti  = tiScore(sym);
        const rr  = rrScore(sym);
        const srhs = srhsTotal(pd, ls, cr, ti, rr);

        computed[sym] = {
          srhs:      Math.round(srhs * 10) / 10,
          grade:     getGrade(srhs),
          breakdown: {
            PD: Math.round(pd * 10) / 10, LS: Math.round(ls * 10) / 10,
            CR: Math.round(cr * 10) / 10, TI: Math.round(ti * 10) / 10,
            RR: Math.round(rr * 10) / 10,
          },
          price, crRatio,
          zScore: vols30d.length > 0 ? (() => {
            const mean = vols30d.reduce((a, b) => a + b, 0) / vols30d.length;
            const std  = Math.sqrt(vols30d.reduce((a, b) => a + (b - mean) ** 2, 0) / vols30d.length);
            return std > 0 ? (volume24h - mean) / std : 0;
          })() : 0,
        };
      }

      setResults(computed);
      setLastUpdate(new Date().toLocaleTimeString('ko-KR'));
      setStatus('ok');
      setHistory(prev => {
        const next = { ...prev };
        Object.entries(computed).forEach(([sym, r]) => {
          next[sym] = [...(prev[sym] ?? []).slice(-29), r.srhs];
        });
        return next;
      });

      const newCritical = Object.entries(computed)
        .filter(([sym, r]) => r.grade.label === 'CRITICAL' && !notifiedSymbols.current.has(sym))
        .map(([sym]) => sym);
      if (newCritical.length > 0) {
        sendCriticalNotif(newCritical);
        newCritical.forEach(s => notifiedSymbols.current.add(s));
      }
      Object.entries(computed)
        .filter(([, r]) => r.grade.label !== 'CRITICAL')
        .forEach(([sym]) => notifiedSymbols.current.delete(sym));

    } catch (_e) {
      // 이미 데이터가 있으면 'stale'로 — 기존 데이터 유지, 조용히 재시도
      setStatus(prev => (prev === 'ok' || prev === 'refreshing') ? 'stale' : 'error');
    }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  const toggleExpand = (sym) =>
    setExpanded(p => ({ ...p, [sym]: !p[sym] }));

  const critical = results
    ? Object.entries(results).filter(([, r]) => r.grade.label === 'CRITICAL').map(([s]) => s)
    : [];

  return (
    <div style={{ paddingBottom: 60 }}>

      {/* ── 헤더 ──────────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
        boxShadow: '0 1px 12px rgba(0,0,0,0.07)',
        padding: '0 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 64,
      }}>
        {/* 로고 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>🛡️</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: -0.5, color: 'var(--text1)' }}>SRHS</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: -2 }}>스테이블코인 건전성 지수</div>
          </div>
        </div>

        {/* 탭 + 알림 */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[
            { id: 'dashboard', label: '대시보드' },
            { id: 'guide',     label: '지표 가이드' },
            { id: 'about',     label: '💡 서비스 소개' },
            { id: 'conclusion', label: '📋 결론' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '7px 18px', borderRadius: 22, fontSize: 13, fontWeight: 700,
              background: activeTab === tab.id
                ? 'linear-gradient(135deg, #3B82F6, #6366F1)'
                : 'transparent',
              color: activeTab === tab.id ? '#fff' : 'var(--text2)',
              transition: 'all 0.2s',
            }}>
              {tab.label}
            </button>
          ))}
          {notifPerm !== 'unsupported' && notifPerm !== 'granted' && (
            <button
              onClick={() => Notification.requestPermission().then(p => setNotifPerm(p))}
              style={{
                padding: '7px 14px', borderRadius: 22, fontSize: 12, fontWeight: 700,
                background: '#FFFBEB', color: '#F59E0B',
                border: '1.5px solid #FDE68A',
              }}
            >
              🔔 알림 허용
            </button>
          )}
          {notifPerm === 'granted' && (
            <span style={{
              padding: '7px 14px', borderRadius: 22, fontSize: 12, fontWeight: 700,
              background: '#ECFDF5', color: 'var(--green)', border: '1.5px solid #6EE7B7',
            }}>🔔 알림 ON</span>
          )}
        </div>

        {/* 상태 */}
        <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'right' }}>
          {status === 'loading' && <span style={{ color: 'var(--yellow)', fontWeight: 700 }}>● 로딩 중…</span>}
          {status === 'refreshing' && (
            <>
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>● 실시간</span>
              <br /><span>{lastUpdate}</span>
            </>
          )}
          {status === 'ok' && (
            <>
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>● 실시간</span>
              <br /><span>{lastUpdate}</span>
            </>
          )}
          {status === 'stale' && (
            <>
              <span style={{ color: 'var(--yellow)', fontWeight: 700 }}>● 재시도 중</span>
              <br /><span>마지막: {lastUpdate}</span>
            </>
          )}
          {status === 'error' && <span style={{ color: 'var(--red)', fontWeight: 700 }}>● 연결 실패</span>}
        </div>
      </header>

      {/* ── CRITICAL 경보 배너 ─────────────────────────────────────────── */}
      {critical.length > 0 && (
        <div style={{
          background: '#FEF2F2', borderBottom: '1px solid #FECACA',
          padding: '14px 28px', fontSize: 14, fontWeight: 800, color: '#EF4444',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          🔴 즉시 교체 권고:&nbsp;<strong>{critical.join(', ')}</strong>
          &nbsp;— 위험점수 76점 초과. 즉시 결제 수단 변경을 검토하세요.
        </div>
      )}

      <div style={{ padding: '22px 24px 0' }}>

        {/* ── 대시보드 탭 ───────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <>
            {status === 'error' && (
              <div style={{
                background: '#FFFBEB', border: '1px solid #FDE68A',
                borderRadius: 14, padding: '14px 18px', marginBottom: 18,
                color: 'var(--yellow)', fontWeight: 700, fontSize: 13,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                ⚠️ API 연결 중… 잠시 후 자동으로 재시도합니다.
                <button
                  onClick={fetchAll}
                  style={{
                    marginLeft: 'auto', padding: '5px 14px', borderRadius: 10,
                    background: 'var(--yellow)', color: '#fff', fontSize: 12, fontWeight: 800,
                  }}
                >지금 재시도</button>
              </div>
            )}

            {/* 추천 배너 */}
            {results && (() => {
              const sorted = Object.entries(results).sort((a, b) => a[1].srhs - b[1].srhs);
              const [bestSym, bestR] = sorted[0];
              const [worstSym, worstR] = sorted[sorted.length - 1];
              const worstGm = GRADE_META[worstR.grade.label];
              return (
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18,
                }}>
                  <div style={{
                    background: '#ECFDF5', border: '1.5px solid #6EE7B7',
                    borderRadius: 14, padding: '14px 18px',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}>
                    <span style={{ fontSize: 28 }}>✅</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--green)', letterSpacing: 0.5 }}>
                        지금 결제하기 가장 안전한 코인
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text1)', marginTop: 2 }}>
                        {COIN_INFO[bestSym].emoji} {bestSym}
                        <span style={{ fontSize: 15, color: 'var(--green)', marginLeft: 8 }}>{bestR.srhs.toFixed(1)}점</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                        {bestR.grade.text}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>세션 추이</div>
                      <Sparkline data={history[bestSym]} color="var(--green)" />
                    </div>
                  </div>
                  <div style={{
                    background: worstGm.bg, border: `1.5px solid ${worstR.grade.color}55`,
                    borderRadius: 14, padding: '14px 18px',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}>
                    <span style={{ fontSize: 28 }}>{worstGm.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: worstR.grade.color, letterSpacing: 0.5 }}>
                        현재 위험점수가 가장 높은 코인
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text1)', marginTop: 2 }}>
                        {COIN_INFO[worstSym].emoji} {worstSym}
                        <span style={{ fontSize: 15, color: worstR.grade.color, marginLeft: 8 }}>{worstR.srhs.toFixed(1)}점</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                        {worstR.grade.text}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>세션 추이</div>
                      <Sparkline data={history[worstSym]} color={worstR.grade.color} />
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 요약 카드 4개 */}
            {results ? (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 14, marginBottom: 22,
              }}>
                {Object.entries(results)
                  .sort((a, b) => a[1].srhs - b[1].srhs)
                  .map(([sym, r]) => {
                    const g  = getGrade(r.srhs);
                    const gm = GRADE_META[g.label];
                    return (
                      <div key={sym} style={{
                        background: 'var(--surface)',
                        borderRadius: 16, padding: '18px 20px',
                        boxShadow: 'var(--shadow)',
                        border: '1px solid var(--border)',
                        borderTop: `4px solid ${g.color}`,
                        cursor: 'pointer',
                      }}
                        onClick={() => {
                          setExpanded(p => ({ ...p, [sym]: true }));
                          document.getElementById(`card-${sym}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 800 }}>
                            {COIN_INFO[sym].emoji} {sym}
                          </span>
                          <span style={{
                            fontSize: 10, fontWeight: 800, padding: '2px 8px',
                            borderRadius: 10, background: gm.bg, color: gm.text,
                          }}>{gm.emoji} {gm.label}</span>
                        </div>
                        <div style={{ fontSize: 34, fontWeight: 900, color: g.color, letterSpacing: -1, lineHeight: 1 }}>
                          {r.srhs.toFixed(1)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, marginBottom: 8 }}>위험점수 / 100점</div>
                        <Sparkline data={history[sym]} color={g.color} width={90} height={22} />
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
                {[0,1,2,3].map(i => (
                  <div key={i} style={{
                    height: 110, background: 'var(--surface)', borderRadius: 16,
                    animation: 'pulse 1.4s ease infinite', boxShadow: 'var(--shadow)',
                  }} />
                ))}
              </div>
            )}

            {/* 코인 카드 그리드 */}
            {!results ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[0,1,2,3].map(i => (
                  <div key={i} style={{
                    height: 220, background: 'var(--surface)', borderRadius: 'var(--radius)',
                    animation: 'pulse 1.4s ease infinite', boxShadow: 'var(--shadow)',
                  }} />
                ))}
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                  {Object.entries(results).map(([sym, data]) => (
                    <div key={sym} id={`card-${sym}`}>
                      <CoinCard sym={sym} data={data}
                        expanded={!!expanded[sym]}
                        onToggle={() => toggleExpand(sym)} />
                    </div>
                  ))}
                </div>
                <CompareTable results={results} />
              </>
            )}
          </>
        )}

        {/* ── 지표 가이드 탭 ────────────────────────────────────────────── */}
        {activeTab === 'guide' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* SRHS 공식 */}
            <div style={{
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '24px 26px',
            }}>
              <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6, color: 'var(--text1)' }}>
                📐 SRHS 공식
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
                5개 지표를 가중 합산한 위험점수 (0~100점, 높을수록 위험)
              </div>
              <div style={{
                background: 'var(--blue-bg)', borderRadius: 12, padding: '16px 22px',
                fontFamily: 'monospace', fontSize: 15, color: 'var(--blue)', lineHeight: 2,
                border: '1px solid #BFDBFE',
              }}>
                SRHS = PD×20% + LS×20% + CR×25% + TI×20% + RR×15%
              </div>

              <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {[
                  { range: '0~30',   label: 'LOW',      color: 'var(--green)',  bg: '#ECFDF5', emoji: '✅', desc: '정상 · 계속 사용 가능' },
                  { range: '31~55',  label: 'CAUTION',  color: 'var(--yellow)', bg: '#FFFBEB', emoji: '⚠️', desc: '주의 · 모니터링 강화' },
                  { range: '56~75',  label: 'HIGH',     color: 'var(--orange)', bg: '#FFF7ED', emoji: '🔶', desc: '위험 · 교체 검토' },
                  { range: '76~100', label: 'CRITICAL', color: 'var(--red)',    bg: '#FEF2F2', emoji: '🔴', desc: '즉시 교체 권고' },
                ].map(g => (
                  <div key={g.label} style={{
                    background: g.bg, borderRadius: 14, padding: '14px 16px',
                    border: `1.5px solid ${g.color}44`,
                  }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{g.emoji}</div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: g.color }}>{g.range}점</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: 'var(--text1)', marginTop: 2 }}>{g.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{g.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 지표별 카드 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {Object.entries(METRIC_INFO).map(([k, m]) => (
                <div key={k} style={{
                  background: 'var(--surface)', borderRadius: 'var(--radius)',
                  boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '20px 22px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{
                      fontSize: 13, fontWeight: 900, padding: '5px 14px',
                      borderRadius: 10, background: 'var(--blue-bg)', color: 'var(--blue)',
                      border: '1px solid #BFDBFE',
                    }}>{k}</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text1)' }}>{m.full}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.75, marginBottom: 8 }}>
                    {m.desc}
                  </div>
                  <div style={{
                    fontSize: 12, color: 'var(--text1)', lineHeight: 1.75, marginBottom: 10,
                    background: '#EFF6FF', borderRadius: 10, padding: '10px 14px',
                    border: '1px solid #BFDBFE',
                  }}>
                    💼 {m.detail}
                  </div>
                  <div style={{
                    fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)',
                    borderRadius: 10, padding: '8px 12px', border: '1px solid var(--border)',
                  }}>
                    📌 {m.src}
                  </div>
                  {results && (
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {Object.entries(results).map(([sym, r]) => {
                        const v = r.breakdown[k];
                        const c = scoreColor(v);
                        const bgM = { 'var(--green)': '#ECFDF5', 'var(--yellow)': '#FFFBEB', 'var(--orange)': '#FFF7ED', 'var(--red)': '#FEF2F2' };
                        return (
                          <div key={sym} style={{
                            padding: '5px 12px', borderRadius: 10, fontSize: 12,
                            background: bgM[c] ?? 'var(--surface2)',
                            fontWeight: 800, display: 'flex', gap: 6,
                            border: `1px solid ${c}44`,
                          }}>
                            <span style={{ color: 'var(--text2)' }}>{COIN_INFO[sym].emoji} {sym}</span>
                            <span style={{ color: c }}>{v.toFixed(1)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 준비금이란? */}
            <div style={{
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '24px 26px',
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6, color: 'var(--text1)' }}>
                💰 준비금(Reserve)이란?
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 18, lineHeight: 1.75 }}>
                스테이블코인 발행사가 <strong>"코인 1개 = $1"을 보장하기 위해 실제로 보관하는 자산</strong>입니다.
                코인 보유자가 달러로 환매 요청하면 이 자산으로 돌려줍니다.
              </div>

              {/* 은행 비유 */}
              <div style={{
                background: '#EFF6FF', borderRadius: 14, padding: '18px 20px', marginBottom: 18,
                border: '1px solid #BFDBFE',
              }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: 'var(--blue)', marginBottom: 10 }}>
                  🏦 은행과 비교하면 이해가 쉽습니다
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>은행 지급준비금</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
                      고객이 100만 원을 맡기면 은행은 법적으로 일정 비율(지급준비율)을 현금으로 보관해야 합니다.
                      나머지는 대출로 운용하지만, 예금자가 인출 요청하면 즉시 줄 수 있어야 합니다.
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>스테이블코인 준비금</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
                      USDT 100달러를 발행하면 발행사는 100달러 가치의 자산(현금·국채 등)을 보관해야 합니다.
                      그런데 USDT는 62%만 보관합니다. 나머지 38달러는 어디에 있는지 불명확합니다.
                    </div>
                  </div>
                </div>
              </div>

              {/* 준비금 비율 시각화 */}
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12, color: 'var(--text1)' }}>
                📊 코인별 준비금 비율 비교 (공식 출처 기준)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
                {[
                  { sym: 'USDC',  pct: 92,  src: 'Circle 주간 Reserve Report (Grant Thornton 감사)', color: 'var(--green)',  good: true,  note: '달러 100% + 미국 단기채권. 매주 독립 감사.' },
                  { sym: 'DAI',   pct: 140, src: 'DeFiLlama MakerDAO TVL 실시간 자동 계산',          color: 'var(--green)',  good: true,  note: '암호화폐 초과 담보(ETH·BTC 등). 스마트컨트랙트 온체인 공개.' },
                  { sym: 'PYUSD', pct: 78,  src: 'PayPal 분기별 준비금 공시 보고서',                 color: 'var(--yellow)', good: false, note: '달러·단기채권. 분기 1회 공개.' },
                  { sym: 'USDT',  pct: 62,  src: 'Tether 분기 Transparency Report (2024 Q4)',       color: 'var(--red)',    good: false, note: '현금+채권+기타(상업어음 포함). 독립 감사 없음.' },
                ].map(r => (
                  <div key={r.sym} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 52, fontWeight: 900, fontSize: 13, flexShrink: 0 }}>
                      {COIN_INFO[r.sym].emoji} {r.sym}
                    </span>
                    <div style={{ flex: 1, position: 'relative', height: 24, background: '#F0F3FA', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(r.pct, 100)}%`, height: '100%',
                        background: r.color, borderRadius: 6,
                        transition: 'width 0.8s ease',
                        opacity: 0.85,
                      }} />
                      {r.pct > 100 && (
                        <div style={{
                          position: 'absolute', left: 0, top: 0,
                          width: '100%', height: '100%',
                          background: `repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(0,184,122,0.15) 4px, rgba(0,184,122,0.15) 8px)`,
                          borderRadius: 6,
                        }} />
                      )}
                    </div>
                    <span style={{ width: 44, fontWeight: 900, fontSize: 14, color: r.color, flexShrink: 0, textAlign: 'right' }}>
                      {r.pct}%
                    </span>
                    <div style={{ flex: 2, fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>
                      <span style={{ color: 'var(--text3)', fontWeight: 700 }}>출처: </span>{r.src}<br />
                      <span style={{ color: r.good ? 'var(--green)' : 'var(--text3)' }}>{r.note}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* 왜 코인마다 다른가 */}
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12, color: 'var(--text1)' }}>
                ❓ 왜 코인마다 준비금 비율이 다를까?
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { emoji: '⚖️', color: '#EFF6FF', tc: 'var(--blue)',  title: '규제 압력 차이',
                    body: 'Circle(USDC)은 미국 금융당국 규제를 받아 준비금 구성과 감사를 법적으로 의무화합니다. Tether(USDT)는 홍콩·BVI 소재로 규제가 느슨해 62%도 법적 문제가 없습니다.' },
                  { emoji: '🏛️', color: '#ECFDF5', tc: 'var(--green)', title: 'DAI가 140%인 이유',
                    body: 'DAI는 발행사가 없어 "신뢰" 대신 "과담보"로 안전성을 확보합니다. ETH 100달러를 맡기면 최대 66달러의 DAI만 발행 가능하게 스마트컨트랙트가 제한합니다.' },
                  { emoji: '💼', color: '#FFFBEB', tc: 'var(--yellow)', title: 'USDT가 62%인 이유',
                    body: '2021년 CFTC·NYAG 조사에서 Tether가 준비금을 100% 보유하지 않음이 드러났습니다. 이후 개선됐지만 아직 62%로 완전 담보에 미달합니다. (CFTC 벌금 $41M 납부)' },
                  { emoji: '📋', color: '#FFF7ED', tc: 'var(--orange)', title: '이게 중요한 이유',
                    body: 'B2B 결제에서 $100만 달러를 USDT로 보유 중 뱅크런이 나면 $38만 달러는 돌려받지 못할 수 있습니다. 준비금 비율은 기업 재무 리스크와 직결됩니다.' },
                ].map((c, i) => (
                  <div key={i} style={{
                    background: c.color, borderRadius: 12, padding: '14px 16px',
                    border: `1px solid ${c.tc}33`,
                  }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: c.tc, marginBottom: 6 }}>
                      {c.emoji} {c.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>{c.body}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 코인별 점수 근거 */}
            <div style={{
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6, color: 'var(--text1)' }}>
                🪙 코인마다 SRHS 점수가 다른 이유
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.7 }}>
                같은 공식 <strong>SRHS = PD×20% + LS×20% + CR×25% + TI×20% + RR×15%</strong>를 사용하지만,
                각 코인의 <strong>발행 구조 · 소재국 · 준비금 투명성</strong>이 달라 항목별 점수가 크게 차이납니다.
                PD·LS는 실시간 시장 데이터, CR·TI·RR는 발행사 공시 및 법령 기반 고정값입니다.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {Object.entries(COIN_SCORE_REASON).map(([sym, info]) => {
                  const ci = COIN_INFO[sym];
                  const liveData = results?.[sym];
                  return (
                    <div key={sym} style={{
                      border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden',
                    }}>
                      {/* 코인 헤더 */}
                      <div style={{
                        padding: '14px 18px', background: 'var(--surface2)',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <span style={{ fontSize: 22 }}>{ci.emoji}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 900, fontSize: 16 }}>{sym}
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)', marginLeft: 8 }}>
                              {ci.name} · {ci.issuer} · {ci.country}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{info.summary}</div>
                        </div>
                        {liveData && (
                          <div style={{
                            padding: '6px 16px', borderRadius: 20, fontWeight: 900, fontSize: 18,
                            color: liveData.grade.color,
                            background: GRADE_META[liveData.grade.label].bg,
                            border: `1.5px solid ${liveData.grade.color}44`,
                          }}>
                            {liveData.srhs.toFixed(1)}점
                          </div>
                        )}
                      </div>
                      {/* 항목별 이유 */}
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
                      }}>
                        {info.items.map((item, idx) => {
                          const liveScore = liveData?.breakdown[item.metric];
                          const isLast = idx >= info.items.length - 2;
                          return (
                            <div key={item.metric} style={{
                              padding: '12px 16px',
                              borderRight: idx % 2 === 0 ? '1px solid var(--border)' : 'none',
                              borderBottom: isLast ? 'none' : '1px solid var(--border)',
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                                <span style={{
                                  fontSize: 11, fontWeight: 900, padding: '2px 8px',
                                  borderRadius: 6, background: 'var(--blue-bg)', color: 'var(--blue)',
                                  border: '1px solid #BFDBFE', flexShrink: 0,
                                }}>{item.metric}</span>
                                <span style={{ fontSize: 13, fontWeight: 800 }}>{item.icon} {item.title}</span>
                                {liveScore !== undefined && (
                                  <span style={{
                                    marginLeft: 'auto', fontSize: 13, fontWeight: 900,
                                    color: scoreColor(liveScore), flexShrink: 0,
                                  }}>{liveScore.toFixed(1)}</span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>
                                {item.body}
                              </div>
                              {item.fixed && (
                                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                                  📌 공시·법령 기반 고정값
                                </div>
                              )}
                              {!item.fixed && (
                                <div style={{ fontSize: 10, color: 'var(--blue)', marginTop: 4 }}>
                                  ⚡ 실시간 갱신
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 코인 설명 */}
            <div style={{
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 16, color: 'var(--text1)' }}>🪙 측정 대상 코인</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {Object.entries(COIN_INFO).map(([sym, info]) => (
                  <div key={sym} style={{
                    background: 'var(--surface2)', borderRadius: 14, padding: '16px 18px',
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontWeight: 900, marginBottom: 4, fontSize: 15 }}>
                      {info.emoji} {sym}
                      <span style={{ fontWeight: 500, color: 'var(--text2)', fontSize: 13, marginLeft: 6 }}>
                        — {info.name}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
                      {info.issuer} · {info.country}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.65 }}>
                      {info.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 갱신 방식 */}
            <div style={{
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 16, color: 'var(--text1)' }}>🔄 데이터 갱신 방식</div>
              {[
                { bg: '#ECFDF5', color: 'var(--green)',  emoji: '⚡', title: '45초마다 자동 갱신',   desc: '현재 시세 (CoinGecko), DAI 담보비율 (DeFiLlama)' },
                { bg: '#FFFBEB', color: 'var(--yellow)', emoji: '📊', title: '1시간마다 자동 갱신',  desc: '30일 거래량 통계 (LS Z-score 계산용)' },
                { bg: '#F0F3FA', color: 'var(--text3)',  emoji: '📋', title: '수동 업데이트',         desc: '발행사 공시 기준값 (CR·TI), 법령 기반 점수 (RR)' },
              ].map((r, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 14, marginBottom: 12, alignItems: 'flex-start',
                  background: r.bg, borderRadius: 12, padding: '14px 16px',
                }}>
                  <span style={{ fontSize: 22 }}>{r.emoji}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: r.color }}>{r.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 3 }}>{r.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 서비스 소개 탭 ────────────────────────────────────────────── */}
        {activeTab === 'about' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 20 }}>

            {/* 한눈에 보는 SRHS */}
            <div style={{
              background: 'linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)',
              borderRadius: 'var(--radius)', padding: '28px 30px', color: '#fff',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.8, marginBottom: 6, letterSpacing: 1 }}>
                STABLECOIN RISK HEALTH SCORE
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 10, letterSpacing: -0.5 }}>
                🛡️ SRHS란 무엇인가?
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.8, opacity: 0.92 }}>
                SRHS는 B2B 무역결제에 사용되는 스테이블코인의 <strong>건전성을 실시간으로 점수화</strong>하는 시스템입니다.<br />
                한국 외국환거래법·CARF MCAA 규제 변수를 최초로 통합하여, 기업 재무팀과 컴플라이언스 담당자가
                별도 분석 없이 즉시 결제 수단 교체 여부를 판단할 수 있도록 설계됐습니다.
              </div>
            </div>

            {/* 기존 서비스와의 비교 */}
            <div style={{
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '24px 26px',
            }}>
              <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>📊 기존 서비스 현황</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.7 }}>
                기존 스테이블코인 리스크 평가 서비스들은 모두 <strong>DeFi 투자자 또는 기관 투자 목적</strong>으로 설계됐습니다.
                한국 B2B 무역결제 기업이 활용할 수 있는 전용 시스템은 존재하지 않았습니다.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      {['서비스', '운영사', '주요 대상', '핵심 지표', '규제 변수', '한국 법령'].map(h => (
                        <th key={h} style={{
                          padding: '10px 16px', textAlign: 'left', fontWeight: 800,
                          color: 'var(--text3)', borderBottom: '1px solid var(--border)',
                          whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: 'Webacy',        co: 'Webacy Inc.',    target: 'DeFi 개인 투자자',      metric: '스마트컨트랙트 취약점·지갑 위험', reg: '❌', kr: '❌' },
                      { name: "Moody's DAM",   co: "Moody's",        target: '기관 투자자',           metric: '신용등급·시장위험·유동성',       reg: '부분', kr: '❌' },
                      { name: 'Chainlink',     co: 'Chainlink Labs', target: 'DeFi 프로토콜',         metric: '온체인 가격 오라클',             reg: '❌', kr: '❌' },
                      { name: 'Chaos Labs',    co: 'Chaos Labs',     target: 'DeFi 파라미터 관리',    metric: '청산 위험·TVL 변동',             reg: '❌', kr: '❌' },
                      { name: 'Nansen',        co: 'Nansen',         target: '투자·트레이딩',         metric: '고래 자금 이동·수익 분석',       reg: '❌', kr: '❌' },
                      { name: '🛡️ SRHS',      co: '연구팀',         target: 'B2B 무역결제 기업 ★',  metric: 'PD·LS·CR·TI·RR 복합 지수',     reg: 'CARF MCAA ✅', kr: '외국환거래법 ✅' },
                    ].map((r, i) => (
                      <tr key={r.name} style={{
                        borderBottom: '1px solid var(--border)',
                        background: i === 5 ? '#EFF6FF' : i % 2 === 0 ? 'transparent' : 'var(--surface2)',
                        fontWeight: i === 5 ? 800 : 400,
                      }}>
                        <td style={{ padding: '12px 16px', color: i === 5 ? 'var(--blue)' : 'var(--text1)' }}>{r.name}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--text2)' }}>{r.co}</td>
                        <td style={{ padding: '12px 16px', color: i === 5 ? 'var(--blue)' : 'var(--text1)' }}>{r.target}</td>
                        <td style={{ padding: '12px 16px', color: 'var(--text2)', fontSize: 12 }}>{r.metric}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>{r.reg}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>{r.kr}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 왜 만들었나 + 이득 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{
                background: 'var(--surface)', borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
              }}>
                <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 14 }}>🎯 왜 만들었나</div>
                {[
                  { emoji: '❗', title: '공백 발견', body: '한국 기업이 스테이블코인으로 무역결제를 할 때 법적 리스크를 판단할 전용 도구가 없었습니다. 기존 서비스는 모두 투자 관점으로 설계됐습니다.' },
                  { emoji: '📜', title: 'CARF 체결', body: '2024년 11월 한국이 CARF MCAA에 서명(48개국)하면서 스테이블코인 과세 투명성 요구가 본격화됐습니다. 규제 미준수 코인 사용 시 법인세·외환 신고 리스크가 현실화됩니다.' },
                  { emoji: '💡', title: '연구 목표', body: '결제 담당자가 전문 지식 없이도 화면만 보고 즉시 교체 여부를 판단할 수 있는 직관적 지수를 개발하는 것이 목표입니다.' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{s.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>{s.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>{s.body}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                background: 'var(--surface)', borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
              }}>
                <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 14 }}>💰 누가 이득을 보나</div>
                {[
                  { emoji: '🏢', target: '수출입 기업 재무팀', body: '결제 수단 선정 시 SRHS 점수 기준으로 LOW·CAUTION 코인만 사용. 환차손·준비금 부실 리스크를 사전에 차단합니다.' },
                  { emoji: '⚖️', target: '컴플라이언스 담당자', body: 'RR 점수로 외국환거래법·CARF 준수 여부를 즉시 확인. 과세 추적 불가 코인(USDT 등) 사용을 사전에 차단합니다.' },
                  { emoji: '🏦', target: '무역금융 플랫폼', body: 'SRHS API를 연동해 결제 시점에 코인 건전성을 자동 검증. 이상 감지 시 대체 코인으로 자동 라우팅하는 시스템 구축이 가능합니다.' },
                ].map((s, i) => (
                  <div key={i} style={{
                    background: 'var(--surface2)', borderRadius: 12, padding: '14px 16px',
                    marginBottom: 10, border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
                      {s.emoji} {s.target}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>{s.body}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 법적·기술적 가능성 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{
                background: 'var(--surface)', borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
              }}>
                <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 14 }}>⚖️ 법적 가능성</div>
                {[
                  { label: '외국환거래법 제18조', color: '#ECFDF5', tc: 'var(--green)', body: '스테이블코인을 이용한 자본거래 시 한국은행 신고 의무. SRHS의 RR 지표가 이 리스크를 정량화합니다.' },
                  { label: 'CARF MCAA (2024.11)', color: '#EFF6FF', tc: 'var(--blue)', body: '48개국 암호화폐 과세정보 자동교환 협약. 홍콩·BVI 미가입 → USDT 발행사 Tether는 추적 불가 → 고위험.' },
                  { label: 'FATCA · CRS', color: '#FFFBEB', tc: 'var(--yellow)', body: '미국·OECD 금융정보 공유 체계. USDC(미국 규제)는 이미 준수, DAI(탈중앙화)는 해당 없음.' },
                ].map((s, i) => (
                  <div key={i} style={{
                    background: s.color, borderRadius: 12, padding: '14px 16px', marginBottom: 10,
                    borderLeft: `3px solid ${s.tc}`,
                  }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: s.tc, marginBottom: 5 }}>{s.label}</div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>{s.body}</div>
                  </div>
                ))}
              </div>

              <div style={{
                background: 'var(--surface)', borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
              }}>
                <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 14 }}>🔧 기술적 가능성</div>
                {[
                  { emoji: '📡', title: 'CoinGecko API', body: '시세·거래량 45초 갱신. 무료 플랜으로 운영 가능하며, Pro 플랜 업그레이드 시 초당 30회 호출 가능.' },
                  { emoji: '🔗', title: 'DeFiLlama API', body: 'MakerDAO TVL 실시간 조회. 완전 무료·오픈소스. DAI 담보비율의 유일한 실시간 데이터 소스.' },
                  { emoji: '🌐', title: '브라우저 기반', body: '별도 서버 없이 브라우저에서 직접 API 호출. 로그인 불필요. 모바일·PC 모두 지원.' },
                  { emoji: '📦', title: '특허 가능성', body: 'CARF+외국환거래법 통합 방법 특허, B2B 결제 건전성 모니터링 시스템 특허, 포트폴리오 교체 추천 모델 특허 3건 출원 검토 중.' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{s.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 3 }}>{s.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>{s.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 알림 시스템 */}
            <div style={{
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '24px 26px',
            }}>
              <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>🔔 위험 감지 시 알림 흐름</div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20, lineHeight: 1.7 }}>
                SRHS가 76점을 초과하면 즉시 교체 권고 등급(CRITICAL)이 발동되고, 아래 3단계로 알림이 전달됩니다.
              </div>

              {/* 플로우 화살표 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24, overflowX: 'auto' }}>
                {[
                  { emoji: '📡', label: 'API 데이터 수신', sub: '45초마다', color: '#EFF6FF', tc: 'var(--blue)' },
                  { arrow: true },
                  { emoji: '🧮', label: 'SRHS 계산', sub: '5개 지표 합산', color: '#F5F3FF', tc: '#7C3AED' },
                  { arrow: true },
                  { emoji: '⚡', label: '76점 초과 감지', sub: 'CRITICAL 등급', color: '#FEF2F2', tc: 'var(--red)' },
                  { arrow: true },
                  { emoji: '🖥️', label: '화면 경보 배너', sub: '즉시 표시', color: '#FEF2F2', tc: 'var(--red)' },
                  { arrow: true },
                  { emoji: '🔔', label: '브라우저 알림', sub: '탭 밖에서도', color: '#ECFDF5', tc: 'var(--green)' },
                ].map((s, i) =>
                  s.arrow ? (
                    <div key={i} style={{ fontSize: 20, color: 'var(--text3)', padding: '0 8px', flexShrink: 0 }}>→</div>
                  ) : (
                    <div key={i} style={{
                      background: s.color, borderRadius: 12, padding: '14px 16px', textAlign: 'center',
                      flexShrink: 0, minWidth: 110, border: `1.5px solid ${s.tc}33`,
                    }}>
                      <div style={{ fontSize: 22, marginBottom: 4 }}>{s.emoji}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: s.tc }}>{s.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{s.sub}</div>
                    </div>
                  )
                )}
              </div>

              {/* 단계별 상세 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  {
                    step: '1단계', emoji: '🖥️', title: '화면 경보 배너',
                    color: '#FEF2F2', tc: 'var(--red)',
                    body: '대시보드 상단에 빨간 배너가 즉시 표시됩니다. 탭을 열어두기만 해도 경보를 확인할 수 있습니다. 별도 설정 없이 자동 작동합니다.',
                  },
                  {
                    step: '2단계', emoji: '🔔', title: '브라우저 푸시 알림',
                    color: '#ECFDF5', tc: 'var(--green)',
                    body: '헤더의 "알림 허용" 버튼으로 권한을 허용하면, 탭이 백그라운드이거나 최소화된 상태에서도 OS 알림이 도착합니다. 같은 코인은 위험이 해소될 때까지 1회만 발송됩니다.',
                  },
                  {
                    step: '현재', emoji: '🟡', title: '지원 중인 알림',
                    color: '#FFFBEB', tc: 'var(--yellow)',
                    body: '화면 경보 배너(항상 작동) + 브라우저 Web Push(권한 허용 시). 두 방식 모두 로그인·앱 설치 없이 브라우저만으로 작동합니다.',
                  },
                  {
                    step: '확장 가능', emoji: '🚀', title: '향후 확장 가능한 알림',
                    color: '#F5F3FF', tc: '#7C3AED',
                    body: '이메일 Webhook(SendGrid·AWS SES), Slack Webhook, 카카오 알림톡 연동이 기술적으로 가능합니다. 서버 추가 시 예약 알림·일일 리포트 자동발송도 구현 가능합니다.',
                  },
                ].map((s, i) => (
                  <div key={i} style={{
                    background: s.color, borderRadius: 14, padding: '16px 18px',
                    border: `1.5px solid ${s.tc}33`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 20 }}>{s.emoji}</span>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: s.tc, letterSpacing: 0.5 }}>{s.step}</div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: 'var(--text1)' }}>{s.title}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.75 }}>{s.body}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ── 결론 탭 ───────────────────────────────────────────────────── */}
        {activeTab === 'conclusion' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 20 }}>

            {/* 한 줄 요약 */}
            <div style={{
              background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A8E 100%)',
              borderRadius: 'var(--radius)', padding: '28px 32px', color: '#fff',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7, letterSpacing: 1.5, marginBottom: 8 }}>
                RESEARCH CONCLUSION · 2025
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, lineHeight: 1.4, marginBottom: 12 }}>
                📋 SRHS 연구 결론 요약
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.85, opacity: 0.92 }}>
                한국 B2B 무역결제 기업은 스테이블코인 사용 시 <strong>준비금 부족·투명성 부재·규제 미준수</strong>라는
                세 가지 복합 리스크에 동시 노출됩니다. 기존 서비스는 모두 투자자·DeFi 관점이며 한국 법령을 반영하지
                않습니다. SRHS는 외국환거래법·CARF MCAA를 최초로 통합한 실시간 건전성 지수로,
                결제 담당자가 전문 지식 없이도 즉시 교체 판단이 가능한 의사결정 도구입니다.
              </div>
            </div>

            {/* 핵심 발견 */}
            <div style={{
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '24px 26px',
            }}>
              <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 16 }}>🔍 핵심 연구 발견</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { emoji: '💸', color: '#FEF2F2', tc: 'var(--red)',    title: '발견 1 — 준비금 격차',
                    body: 'USDC(92%)와 USDT(62%) 간 준비금 비율 격차가 30%p에 달합니다. 같은 $1 달러 연동 코인이라도 뱅크런 시 회수 가능 금액이 30% 차이납니다. B2B 결제에서는 이 차이가 직접적인 손실로 이어집니다.' },
                  { emoji: '⚖️', color: '#FFF7ED', tc: 'var(--orange)', title: '발견 2 — 규제 비대칭',
                    body: 'CARF MCAA(2024.11 한국 서명) 기준으로 USDT 발행사 Tether는 홍콩·BVI 소재로 과세 정보 추적이 불가능합니다. 동일한 달러 연동 코인이라도 법적 리스크가 최대 4배(RR 14점 vs 55점) 차이납니다.' },
                  { emoji: '📊', color: '#ECFDF5', tc: 'var(--green)', title: '발견 3 — USDC 우위',
                    body: '현재 점수 기준 USDC(~5점)가 압도적으로 안전합니다. 준비금 92%·주간 감사·미국 CARF 준수가 모두 충족됩니다. B2B 무역결제 첫 번째 선택지로 USDC를 권고합니다.' },
                  { emoji: '🤖', color: '#EFF6FF', tc: 'var(--blue)',  title: '발견 4 — DAI의 이중성',
                    body: 'DAI는 담보비율 140%·온체인 투명성으로 CR·TI는 우수하지만, 탈중앙화 구조로 법적 관할권이 불명확합니다. 기술적으로는 안전하나 한국 컴플라이언스 관점에서는 불확실성이 존재합니다.' },
                ].map((f, i) => (
                  <div key={i} style={{
                    background: f.color, borderRadius: 14, padding: '16px 18px',
                    border: `1.5px solid ${f.tc}33`,
                  }}>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>{f.emoji}</div>
                    <div style={{ fontWeight: 900, fontSize: 14, color: f.tc, marginBottom: 6 }}>{f.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.75 }}>{f.body}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 실시간 현재 점수 요약 */}
            {results && (() => {
              const sorted = Object.entries(results).sort((a, b) => a[1].srhs - b[1].srhs);
              const rankMedals = ['🥇', '🥈', '🥉', '🔸'];
              const rankNames  = ['1순위', '2순위', '3순위', '4순위'];
              const rankLabels = ['🥇 1순위', '🥈 2순위', '🥉 3순위', '🔸 4순위'];
              const recs       = ['✅ 1순위 추천', '✅ 2순위 추천', '⚠️ 주의 사용', '🔶 비권고'];
              const rankReasons = {
                0: '가장 낮은 위험점수. 준비금·투명성·규제 세 항목이 모두 우수하며, 한국 CARF 법령 준수로 컴플라이언스 리스크가 가장 적습니다.',
                1: '2번째로 낮은 위험점수. CR·TI가 양호하지만 규제 불확실성(DAI) 또는 준비금 미달(PYUSD)로 1순위보다 점수가 높습니다.',
                2: '주의가 필요한 수준. 일부 항목에서 30점 이상의 위험점수가 발생하고 있어 결제 전 반드시 점수를 확인하세요.',
                3: '가장 높은 위험점수. 준비금 부족·불투명 공시·규제 미준수 중 복수 항목이 위험 구간에 있어 B2B 결제에 권고하지 않습니다.',
              };
              return (
                <div style={{
                  background: 'var(--surface)', borderRadius: 'var(--radius)',
                  boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '24px 26px',
                }}>
                  <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>📡 현재 실시간 측정값</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 18 }}>
                    마지막 갱신: {lastUpdate} · 45초마다 자동 업데이트 · 카드를 클릭하면 순위 이유를 볼 수 있습니다
                  </div>

                  {/* 레이더 차트 + 순위 카드 */}
                  <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 20 }}>
                    {/* 레이더 차트 */}
                    <div style={{
                      background: 'var(--surface2)', borderRadius: 16, padding: '16px 12px',
                      border: '1px solid var(--border)', flexShrink: 0, textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text3)', marginBottom: 6 }}>
                        5개 지표 비교 (높을수록 위험)
                      </div>
                      <RadarChart results={results} />
                      {/* 범례 */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 6 }}>
                        {sorted.map(([sym]) => (
                          <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 3, background: COIN_COLORS[sym] }} />
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)' }}>{sym}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 순위 카드들 */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {sorted.map(([sym, r], i) => {
                        const gm = GRADE_META[r.grade.label];
                        const isOpen = !!expandedRank[i];
                        const topMetric = Object.entries(r.breakdown).sort((a, b) => b[1] - a[1])[0];
                        const botMetric = Object.entries(r.breakdown).sort((a, b) => a[1] - b[1])[0];
                        const borderColor = i === 0 ? '#6EE7B7' : i === 3 ? '#FCA5A5' : 'var(--border)';
                        const bgColor    = i === 0 ? '#F0FDF8' : i === 3 ? '#FFF5F5' : 'var(--surface)';
                        return (
                          <div key={sym} style={{
                            border: `1.5px solid ${borderColor}`, borderRadius: 14, overflow: 'hidden',
                          }}>
                            {/* 카드 헤더 - 클릭 토글 */}
                            <button
                              onClick={() => setExpandedRank(p => ({ ...p, [i]: !p[i] }))}
                              style={{
                                width: '100%', padding: '12px 16px', textAlign: 'left',
                                display: 'flex', alignItems: 'center', gap: 10,
                                background: bgColor,
                                borderBottom: isOpen ? `1px solid ${borderColor}` : 'none',
                              }}
                            >
                              {/* 메달 배지 */}
                              <div style={{
                                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 20,
                                background: i === 0 ? '#D1FAE5' : i === 1 ? '#E8EDF5' : i === 2 ? '#FEF3C7' : '#FEE2E2',
                              }}>
                                {rankMedals[i]}
                              </div>

                              {/* 코인 정보 */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 900, fontSize: 15, whiteSpace: 'nowrap' }}>
                                    {COIN_INFO[sym].emoji} {sym}
                                  </span>
                                  <span style={{
                                    padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 800,
                                    background: gm.bg, color: gm.text, whiteSpace: 'nowrap',
                                  }}>{gm.emoji} {gm.label}</span>
                                  <span style={{
                                    padding: '1px 7px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                                    background: i === 3 ? '#FEE2E2' : '#F0F3FA',
                                    color: i === 3 ? '#EF4444' : 'var(--text3)',
                                    whiteSpace: 'nowrap',
                                  }}>{rankNames[i]}</span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>
                                  위험 높음: <strong style={{ color: scoreColor(topMetric[1]) }}>{topMetric[0]} {topMetric[1].toFixed(0)}점</strong>
                                  &nbsp;·&nbsp;
                                  위험 낮음: <strong style={{ color: scoreColor(botMetric[1]) }}>{botMetric[0]} {botMetric[1].toFixed(0)}점</strong>
                                </div>
                              </div>

                              {/* 스파크라인 */}
                              <div style={{ flexShrink: 0 }}>
                                <Sparkline data={history[sym]} color={r.grade.color} width={72} height={26} />
                              </div>

                              {/* SRHS 점수 */}
                              <div style={{
                                fontSize: 26, fontWeight: 900, color: r.grade.color,
                                letterSpacing: -1, flexShrink: 0, minWidth: 52, textAlign: 'right',
                              }}>
                                {r.srhs.toFixed(1)}
                              </div>

                              <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>
                                {isOpen ? '▲' : '▼'}
                              </span>
                            </button>

                            {/* 확장 영역: 순위 이유 */}
                            {isOpen && (
                              <div style={{ padding: '14px 16px', background: 'var(--surface2)', animation: 'slideDown 0.18s ease' }}>
                                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10, lineHeight: 1.7 }}>
                                  <strong>왜 {rankNames[i]}인가?</strong> — {rankReasons[i]}
                                </div>
                                {/* 지표 바 5개 */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px' }}>
                                  {[
                                    { k: 'PD', label: 'PD 달러이탈', fixed: false },
                                    { k: 'LS', label: 'LS 유동성',   fixed: false },
                                    { k: 'CR', label: 'CR 준비금',   fixed: sym !== 'DAI' },
                                    { k: 'TI', label: 'TI 투명성',   fixed: true },
                                    { k: 'RR', label: 'RR 규제위험', fixed: true },
                                  ].map(({ k, label, fixed }) => {
                                    const v = r.breakdown[k];
                                    const col = scoreColor(v);
                                    return (
                                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 90, flexShrink: 0 }}>
                                          <span style={{ fontSize: 9, color: fixed ? 'var(--text3)' : 'var(--blue)', fontWeight: 800 }}>
                                            {fixed ? '📌' : '⚡'}
                                          </span>
                                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{label}</span>
                                        </div>
                                        <div style={{ flex: 1, height: 8, background: '#E8EDF5', borderRadius: 4, overflow: 'hidden' }}>
                                          <div style={{ width: `${v}%`, height: '100%', background: col, borderRadius: 4, transition: 'width 0.5s ease' }} />
                                        </div>
                                        <span style={{ fontSize: 12, fontWeight: 900, color: col, width: 36, textAlign: 'right', flexShrink: 0 }}>
                                          {v.toFixed(0)}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text3)' }}>
                                  ⚡ 실시간(45초 갱신) &nbsp;·&nbsp; 📌 공시·법령 기반 고정값
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 항목별 비교표 */}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: 'var(--surface2)' }}>
                          {['순위', '코인', 'SRHS', 'PD⚡', 'LS⚡', 'CR📌', 'TI📌', 'RR📌', '준비금', '추천'].map(h => (
                            <th key={h} style={{
                              padding: '10px 14px', textAlign: h === '코인' || h === '순위' ? 'left' : 'center',
                              color: 'var(--text3)', fontWeight: 800, whiteSpace: 'nowrap',
                              borderBottom: '2px solid var(--border)', fontSize: 12,
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map(([sym, r], i) => {
                          const gm = GRADE_META[r.grade.label];
                          return (
                            <tr key={sym} style={{
                              borderBottom: '1px solid var(--border)',
                              background: i === 0 ? '#ECFDF5' : i === 3 ? '#FEF9F9' : i % 2 === 0 ? 'transparent' : 'var(--surface2)',
                            }}>
                              <td style={{ padding: '10px 14px', fontWeight: 900, color: 'var(--text3)', fontSize: 14 }}>
                                {['🥇','🥈','🥉','4️⃣'][i]}
                              </td>
                              <td style={{ padding: '10px 14px', fontWeight: 800 }}>
                                {COIN_INFO[sym].emoji} {sym}
                              </td>
                              <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 900, color: r.grade.color, fontSize: 15 }}>
                                {r.srhs.toFixed(1)}
                              </td>
                              {['PD','LS','CR','TI','RR'].map(k => (
                                <td key={k} style={{ padding: '10px 14px', textAlign: 'center' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                                    <span style={{ fontWeight: 700, color: scoreColor(r.breakdown[k]) }}>
                                      {r.breakdown[k].toFixed(0)}
                                    </span>
                                    <div style={{ width: 36, height: 4, background: '#E8EDF5', borderRadius: 2, overflow: 'hidden' }}>
                                      <div style={{ width: `${r.breakdown[k]}%`, height: '100%', background: scoreColor(r.breakdown[k]), borderRadius: 2 }} />
                                    </div>
                                  </div>
                                </td>
                              ))}
                              <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 800,
                                color: r.crRatio * 100 >= 100 ? 'var(--green)' : r.crRatio * 100 >= 70 ? 'var(--yellow)' : 'var(--red)' }}>
                                {(r.crRatio * 100).toFixed(0)}%
                              </td>
                              <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                <span style={{
                                  padding: '4px 10px', borderRadius: 10, fontSize: 11,
                                  fontWeight: 800, background: gm.bg, color: gm.text,
                                  whiteSpace: 'nowrap',
                                }}>{recs[i]}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* 한계와 향후 과제 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{
                background: 'var(--surface)', borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
              }}>
                <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 14 }}>⚠️ 연구 한계점</div>
                {[
                  { emoji: '📋', title: 'CR·TI·RR 정적 값', body: '준비금·투명성·규제 점수는 발행사 공시 기반 고정값입니다. 공시가 업데이트되면 수동으로 반영해야 하며, 실시간 온체인 검증은 DAI만 가능합니다.' },
                  { emoji: '🌐', title: 'CORS 제약', body: '브라우저 직접 API 호출 구조상 일부 API가 CORS 정책으로 차단될 수 있습니다. 서버 없는 구조의 한계입니다.' },
                  { emoji: '📉', title: '4개 코인 한정', body: 'USDT·USDC·DAI·PYUSD 4개 코인만 평가합니다. BUSD·TUSD·FRAX 등 다른 스테이블코인은 아직 미지원입니다.' },
                  { emoji: '⚖️', title: '규제 변동성', body: 'CARF·외국환거래법은 지속적으로 개정 중입니다. RR 점수는 최신 법령 업데이트를 즉시 반영하지 못할 수 있습니다.' },
                ].map((l, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{l.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 3 }}>{l.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>{l.body}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{
                background: 'var(--surface)', borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
              }}>
                <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 14 }}>🚀 향후 연구 과제</div>
                {[
                  { emoji: '🔄', title: 'CR·TI 실시간화', body: '발행사 공시를 스크래핑하거나 온체인 데이터(Chainlink 준비금 피드)를 연동해 CR·TI를 완전 자동화하는 파이프라인 구축.' },
                  { emoji: '🤖', title: 'AI 이상 감지', body: 'SRHS 시계열에 머신러닝 이상 감지(Anomaly Detection) 모델을 적용해 탈페깅 전 조기 경보 발령 시스템 구축.' },
                  { emoji: '📱', title: '모바일 앱', body: '결제 담당자가 스마트폰에서 실시간 알림을 받을 수 있도록 PWA(Progressive Web App) 또는 네이티브 앱 개발.' },
                  { emoji: '🌏', title: '코인 확장', body: 'BUSD·FRAX·crvUSD 등 추가 스테이블코인과 싱가포르 MAS·EU MiCA 규제 변수를 추가해 글로벌 B2B 결제 커버리지 확장.' },
                ].map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{f.emoji}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 3 }}>{f.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>{f.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 팀 & 출처 */}
            <div style={{
              background: 'var(--surface)', borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)', border: '1px solid var(--border)', padding: '22px 24px',
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 14 }}>👥 연구팀 & 데이터 출처</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text3)', marginBottom: 10, letterSpacing: 0.5 }}>
                    TEAM MEMBERS
                  </div>
                  {[
                    { role: 'PD · LS 지표 개발', name: '오성준', note: 'CoinGecko API 연동, Z-score 알고리즘' },
                    { role: 'TI 투명성 평가',    name: '이민우', note: 'BIS WP#1164, S&P Global 기준 정성 평가' },
                    { role: 'RR 규제 분석',       name: '송승민', note: '외국환거래법, CARF MCAA, FATCA·CRS' },
                  ].map((m, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: 12, marginBottom: 10,
                      padding: '10px 14px', background: 'var(--surface2)',
                      borderRadius: 10, border: '1px solid var(--border)',
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>{m.name}
                          <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500, marginLeft: 6 }}>{m.role}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{m.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text3)', marginBottom: 10, letterSpacing: 0.5 }}>
                    DATA SOURCES
                  </div>
                  {[
                    { src: 'CoinGecko API',  detail: '시세·거래량·유통량 · 45초 실시간 갱신' },
                    { src: 'DeFiLlama API', detail: 'MakerDAO TVL · DAI 담보비율 실시간 계산' },
                    { src: 'BIS WP#1164',   detail: '스테이블코인 투명성 평가 기준' },
                    { src: 'S&P Global',    detail: '스테이블코인 신용 평가 방법론' },
                    { src: '외국환거래법',   detail: '제18조 자본거래 신고의무 · 법무부 공식 법령' },
                    { src: 'CARF MCAA',     detail: 'OECD 암호화폐 과세정보 자동교환 협약 2024.11' },
                  ].map((s, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8,
                      padding: '8px 12px', background: 'var(--surface2)',
                      borderRadius: 8, border: '1px solid var(--border)',
                    }}>
                      <span style={{ fontWeight: 800, fontSize: 12, color: 'var(--blue)', minWidth: 100 }}>{s.src}</span>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>{s.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
