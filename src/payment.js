// ── SRHS 결제 / 구독 시스템 ─────────────────────────────────────────────
//
// 이 앱은 백엔드가 없는 정적 사이트(GitHub Pages)이므로, 서버 없이 동작하는
// 두 가지 결제 경로를 제공한다.
//
//   1) 카드 결제  : Stripe Payment Link 로 리다이렉트 → 성공 시 success URL 로
//                   복귀(?checkout=success&plan=pro)하면 구독을 활성화한다.
//   2) 크립토 결제 : 사용자의 지갑(MetaMask 등)에서 USDC/USDT(ERC-20)를
//                   가맹점 주소로 직접 전송하고, 트랜잭션 영수증을 확인해
//                   구독을 활성화한다. (스테이블코인 서비스 특성에 맞춘 경로)
//
// ⚠️ 실제 결제를 받으려면 아래 STRIPE_LINKS / CRYPTO.merchant 값을 본인 것으로
//    교체해야 한다. 진짜 entitlement(권한 부여)는 위·변조 방지를 위해 서버
//    웹훅에서 검증하는 것이 원칙이며, 그 방법은 README 참고.

import { useState, useEffect } from 'react';

// ── 요금제 정의 ──────────────────────────────────────────────────────────
export const PRICING = {
  free: {
    id: 'free',
    name: 'Free',
    priceKRW: 0,
    priceUSDC: 0,
    period: '',
    tagline: '기본 모니터링',
    accent: '#94A3B8',
    features: [
      '실시간 SRHS 점수 (4개 코인)',
      '코인 카드 · 등급 표시',
      '5분 주기 자동 갱신',
    ],
    locked: [],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceKRW: 9900,
    priceUSDC: 7,          // ≈ $7 / 월
    period: '월',
    tagline: '전문가용 분석',
    accent: '#6366F1',
    popular: true,
    features: [
      'Free의 모든 기능',
      '코인 비교 분석 테이블',
      'CRITICAL 브라우저 알림',
      '30일 점수 히스토리',
      '지표 5종 상세 분해(PD·LS·CR·TI·RR)',
    ],
    locked: [],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceKRW: null,        // 별도 문의
    priceUSDC: null,
    period: '',
    tagline: '기관 · API 연동',
    accent: '#0EA5E9',
    features: [
      'Pro의 모든 기능',
      'REST API / 웹훅 연동',
      '커스텀 코인 · 가중치 설정',
      '전담 지원 · SLA',
    ],
    locked: [],
    contact: 'mailto:sales@srhs.example?subject=SRHS%20Enterprise%20문의',
  },
};

// ── Stripe 카드 결제 ──────────────────────────────────────────────────────
// Stripe 대시보드 > Payment Links 에서 각 플랜의 링크를 만들어 붙여넣는다.
// 링크의 "결제 후 이동" success URL 은 아래처럼 설정한다:
//   https://sojo1211.github.io/SRHS-STABLECOIN-RISK-HEALTH-SCORE-/?checkout=success&plan=pro
export const STRIPE_LINKS = {
  pro: 'https://buy.stripe.com/REPLACE_WITH_YOUR_PRO_LINK',
};

export function isStripeConfigured(plan) {
  const link = STRIPE_LINKS[plan];
  return !!link && !link.includes('REPLACE_WITH');
}

export function startCardCheckout(plan) {
  if (!isStripeConfigured(plan)) {
    throw new Error(
      'Stripe 결제 링크가 아직 설정되지 않았습니다. ' +
      'src/payment.js 의 STRIPE_LINKS 에 본인의 Payment Link 를 넣어주세요.'
    );
  }
  // 어느 플랜을 결제하려 했는지 복귀 시 참조할 수 있게 저장
  try { sessionStorage.setItem('srhs_pending_plan', plan); } catch { /* ignore */ }
  window.location.href = STRIPE_LINKS[plan];
}

// ── 카드(데모) 결제 ───────────────────────────────────────────────────────
// 실제 청구는 PSP(Stripe 등) 없이는 불가능하므로, 백엔드 없는 데모용으로
// 카드 입력·검증·결제 완료 흐름만 시뮬레이션한다. (테스트 카드: 4242 4242 4242 4242)

// 카드 번호 앞자리로 브랜드 판별
export function detectCardBrand(number) {
  const n = String(number).replace(/\D/g, '');
  if (/^4/.test(n))                      return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(n))        return 'Mastercard';
  if (/^3[47]/.test(n))                  return 'Amex';
  if (/^(60|65|81|82|508)/.test(n))      return 'RuPay';
  if (/^35/.test(n))                     return 'JCB';
  return '';
}

// Luhn 체크섬 검증
export function luhnValid(number) {
  const n = String(number).replace(/\D/g, '');
  if (n.length < 13 || n.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = parseInt(n[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// 만료일(MM/YY) 유효성 — 형식 + 미래 시점
export function expiryValid(mmYY) {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(mmYY).trim());
  if (!m) return false;
  const month = parseInt(m[1], 10);
  const year  = 2000 + parseInt(m[2], 10);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const exp = new Date(year, month, 1);            // 해당 월 말일 다음날
  return exp > now;
}

// 데모 카드 결제 처리(실제 청구 없음). 가짜 승인번호를 반환.
export async function processDemoCardPayment({ number }) {
  await new Promise(r => setTimeout(r, 1600));     // 승인 대기 연출
  const digits = String(number).replace(/\D/g, '');
  const last4  = digits.slice(-4);
  const brand  = detectCardBrand(digits);
  return {
    approved: true,
    brand,
    last4,
    auth: `DEMO-${brand.toUpperCase().slice(0, 4)}-${last4}`,
  };
}

// ── 크립토(USDC/USDT) 온체인 결제 ─────────────────────────────────────────
export const CRYPTO = {
  // 결제를 수취할 가맹점 지갑 주소(본인 주소로 교체)
  merchant: '0x0000000000000000000000000000000000000000',
  // Ethereum mainnet
  chainIdHex: '0x1',
  chainName: 'Ethereum',
  tokens: {
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  },
};

export function isCryptoConfigured() {
  return CRYPTO.merchant !== '0x0000000000000000000000000000000000000000';
}

export function hasWallet() {
  return typeof window !== 'undefined' && !!window.ethereum;
}

// ERC-20 transfer(address,uint256) calldata 인코딩 (라이브러리 불필요)
function encodeErc20Transfer(to, amountUnits) {
  const selector = 'a9059cbb';                                   // keccak256("transfer(address,uint256)")[:4]
  const addr = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const amt  = amountUnits.toString(16).padStart(64, '0');
  return '0x' + selector + addr + amt;
}

function toTokenUnits(amount, decimals) {
  // 소수 가격도 안전하게 정수 단위로 변환 (부동소수 오차 방지)
  const [whole, frac = ''] = String(amount).split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
}

// 지갑에서 결제 트랜잭션을 보낸다. txHash 를 반환.
export async function sendCryptoPayment(plan, tokenSym) {
  if (!hasWallet()) {
    throw new Error('이더리움 지갑이 감지되지 않았습니다. MetaMask 등을 설치해주세요.');
  }
  if (!isCryptoConfigured()) {
    throw new Error('가맹점 지갑 주소가 설정되지 않았습니다. src/payment.js 의 CRYPTO.merchant 를 채워주세요.');
  }
  const token = CRYPTO.tokens[tokenSym];
  if (!token) throw new Error(`지원하지 않는 토큰: ${tokenSym}`);

  const price = PRICING[plan]?.priceUSDC;
  if (!price) throw new Error('이 플랜은 크립토 결제를 지원하지 않습니다.');

  const eth = window.ethereum;
  const accounts = await eth.request({ method: 'eth_requestAccounts' });
  const from = accounts[0];

  // 올바른 체인인지 확인하고, 아니면 전환 요청
  const chainId = await eth.request({ method: 'eth_chainId' });
  if (chainId !== CRYPTO.chainIdHex) {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CRYPTO.chainIdHex }],
    });
  }

  const units = toTokenUnits(price, token.decimals);
  const data  = encodeErc20Transfer(CRYPTO.merchant, units);

  const txHash = await eth.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: token.address, data, value: '0x0' }],
  });

  return { txHash, from, token: tokenSym, units: units.toString() };
}

// 트랜잭션이 블록에 포함될 때까지 영수증을 폴링한다.
export async function waitForReceipt(txHash, { tries = 24, intervalMs = 5000 } = {}) {
  if (!hasWallet()) return null;
  for (let i = 0; i < tries; i++) {
    const receipt = await window.ethereum.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    });
    if (receipt) return receipt;                                 // status: '0x1' 성공 / '0x0' 실패
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;                                                   // 타임아웃(아직 pending)
}

// ── 구독 상태 (localStorage) ──────────────────────────────────────────────
const SUB_KEY = 'srhs_subscription';
const SUB_EVENT = 'srhs-sub-change';

export function getSubscription() {
  try {
    const raw = localStorage.getItem(SUB_KEY);
    if (!raw) return null;
    const sub = JSON.parse(raw);
    if (sub.expiresAt && Date.now() > sub.expiresAt) {           // 만료됨
      localStorage.removeItem(SUB_KEY);
      return null;
    }
    return sub;
  } catch {
    return null;
  }
}

export function isPremium() {
  const sub = getSubscription();
  return !!sub && sub.plan && sub.plan !== 'free';
}

export function hasPlan(plan) {
  const sub = getSubscription();
  if (!sub) return plan === 'free';
  if (plan === 'pro')        return sub.plan === 'pro' || sub.plan === 'enterprise';
  if (plan === 'enterprise') return sub.plan === 'enterprise';
  return true;
}

// 결제 완료 후 구독 활성화
export function activateSubscription({ plan, method, ref, days = 30 }) {
  const now = Date.now();
  const sub = {
    plan,
    method,                       // 'card' | 'crypto'
    ref,                          // Stripe session id 또는 tx hash
    startedAt: now,
    expiresAt: now + days * 24 * 60 * 60 * 1000,
  };
  localStorage.setItem(SUB_KEY, JSON.stringify(sub));
  window.dispatchEvent(new Event(SUB_EVENT));
  return sub;
}

export function cancelSubscription() {
  localStorage.removeItem(SUB_KEY);
  window.dispatchEvent(new Event(SUB_EVENT));
}

// 구독 만료까지 남은 일수
export function daysLeft(sub) {
  if (!sub || !sub.expiresAt) return 0;
  return Math.max(0, Math.ceil((sub.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

// 결제 후 Stripe success URL 로 복귀했을 때 호출 — 구독을 활성화하고 URL 을 정리한다.
export function consumeCheckoutReturn() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') !== 'success') return null;

  const plan = params.get('plan')
    || sessionStorage.getItem('srhs_pending_plan')
    || 'pro';
  const ref = params.get('session_id') || 'stripe';
  const sub = activateSubscription({ plan, method: 'card', ref });

  try { sessionStorage.removeItem('srhs_pending_plan'); } catch { /* ignore */ }

  // 쿼리스트링 제거(새로고침 시 재활성화 방지)
  const clean = window.location.origin + window.location.pathname;
  window.history.replaceState({}, '', clean);

  return sub;
}

// ── React 훅 ──────────────────────────────────────────────────────────────
export function useSubscription() {
  const [sub, setSub] = useState(() => getSubscription());
  useEffect(() => {
    const refresh = () => setSub(getSubscription());
    window.addEventListener(SUB_EVENT, refresh);
    window.addEventListener('storage', refresh);
    // 만료 자동 반영(1분마다 점검)
    const id = setInterval(refresh, 60 * 1000);
    return () => {
      window.removeEventListener(SUB_EVENT, refresh);
      window.removeEventListener('storage', refresh);
      clearInterval(id);
    };
  }, []);
  return sub;
}
