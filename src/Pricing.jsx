// ── 요금제 / 결제 UI ───────────────────────────────────────────────────────
import { useState } from 'react';
import {
  PRICING,
  startCardCheckout,
  isStripeConfigured,
  sendCryptoPayment,
  waitForReceipt,
  hasWallet,
  isCryptoConfigured,
  activateSubscription,
  cancelSubscription,
  useSubscription,
  daysLeft,
  isLifetime,
  detectCardBrand,
  luhnValid,
  expiryValid,
  processDemoCardPayment,
} from './payment.js';

const won = (n) => n.toLocaleString('ko-KR');

const BRAND_BADGE = {
  Visa:       { label: 'VISA',  color: '#1A1F71' },
  Mastercard: { label: 'MC',    color: '#EB001B' },
  Amex:       { label: 'AMEX',  color: '#2E77BC' },
  JCB:        { label: 'JCB',   color: '#0B4EA2' },
  RuPay:      { label: 'RuPay', color: '#097DB6' },
};

// ── 카드 입력 폼 (데모) ────────────────────────────────────────────────────
function CardForm({ tier, busy, onSubmit }) {
  const [number, setNumber] = useState('');
  const [exp, setExp]       = useState('');
  const [cvc, setCvc]       = useState('');
  const [name, setName]     = useState('');
  const [err, setErr]       = useState('');

  const brand = detectCardBrand(number);

  const onNumber = (v) => {
    const digits = v.replace(/\D/g, '').slice(0, 19);
    setNumber(digits.replace(/(.{4})/g, '$1 ').trim());
  };
  const onExp = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    setExp(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
  };

  const submit = () => {
    if (!luhnValid(number))        return setErr('카드 번호를 확인해주세요.');
    if (!expiryValid(exp))         return setErr('유효기간(MM/YY)을 확인해주세요.');
    if (!/^\d{3,4}$/.test(cvc))    return setErr('CVC를 확인해주세요.');
    if (name.trim().length < 2)    return setErr('카드 소유자 이름을 입력해주세요.');
    setErr('');
    onSubmit({ number, exp, cvc, name });
  };

  const input = {
    width: '100%', padding: '11px 12px', borderRadius: 10, fontSize: 14,
    border: '1.5px solid var(--border)', background: '#fff', boxSizing: 'border-box',
    fontFamily: 'inherit',
  };
  const label = { fontSize: 11.5, fontWeight: 800, color: 'var(--text3)', marginBottom: 5, display: 'block' };

  return (
    <div>
      {/* 허용 카드 브랜드 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {Object.entries(BRAND_BADGE).slice(0, 4).map(([b, m]) => (
          <span key={b} style={{
            fontSize: 11, fontWeight: 900, letterSpacing: 0.5, padding: '3px 8px', borderRadius: 6,
            color: '#fff', background: m.color,
            opacity: !brand || brand === b ? 1 : 0.25,
            transition: 'opacity 0.2s',
          }}>{m.label}</span>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={label}>카드 번호</span>
        <div style={{ position: 'relative' }}>
          <input value={number} onChange={e => onNumber(e.target.value)} inputMode="numeric"
                 placeholder="4242 4242 4242 4242" disabled={busy}
                 style={{ ...input, paddingRight: 64, letterSpacing: 1 }} />
          {brand && (
            <span style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 11, fontWeight: 900, color: BRAND_BADGE[brand].color,
            }}>{BRAND_BADGE[brand].label}</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <span style={label}>유효기간</span>
          <input value={exp} onChange={e => onExp(e.target.value)} inputMode="numeric"
                 placeholder="MM/YY" disabled={busy} style={input} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={label}>CVC</span>
          <input value={cvc} onChange={e => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                 inputMode="numeric" placeholder="123" disabled={busy} style={input} />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <span style={label}>카드 소유자 이름</span>
        <input value={name} onChange={e => setName(e.target.value)}
               placeholder="HONG GILDONG" disabled={busy} style={{ ...input, textTransform: 'uppercase' }} />
      </div>

      {err && <div style={{ fontSize: 12.5, color: 'var(--red)', fontWeight: 700, marginBottom: 12 }}>{err}</div>}

      <button onClick={submit} disabled={busy} style={payBtn}>
        {busy ? '결제 승인 중…' : `₩${won(tier.priceKRW)} 결제하기`}
      </button>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.5 }}>
        🔒 데모 모드 · 실제 청구 없음 · 테스트 카드 <b>4242 4242 4242 4242</b>
      </div>
    </div>
  );
}

// ── 헤더에 표시할 구독 배지 ────────────────────────────────────────────────
export function SubscriptionBadge({ onClick }) {
  const sub = useSubscription();
  if (!sub || sub.plan === 'free') {
    return (
      <button onClick={onClick} style={{
        padding: '7px 14px', borderRadius: 22, fontSize: 12, fontWeight: 800,
        background: 'linear-gradient(135deg, #6366F1, #8B5CF6)', color: '#fff',
      }}>✨ Pro 업그레이드</button>
    );
  }
  const lifetime = isLifetime(sub);
  const left = daysLeft(sub);
  const planLabel = sub.plan === 'lifetime' ? '영구'
    : sub.plan === 'enterprise' ? 'Enterprise' : 'Pro';
  return (
    <button onClick={onClick} title={lifetime ? '영구 이용권' : `${left}일 남음`} style={{
      padding: '7px 14px', borderRadius: 22, fontSize: 12, fontWeight: 800,
      background: lifetime ? '#FEF3C7' : '#EEF2FF',
      color: lifetime ? '#B45309' : '#4F46E5',
      border: lifetime ? '1.5px solid #FCD34D' : '1.5px solid #C7D2FE',
    }}>👑 {planLabel} · {lifetime ? '평생' : `${left}일`}</button>
  );
}

// ── 프리미엄 잠금 래퍼 ─────────────────────────────────────────────────────
// 구독이 없으면 자식 위에 잠금 오버레이를 덮어 미리보기로 보여준다.
export function PremiumGate({ plan = 'pro', title, onUpgrade, children }) {
  const sub = useSubscription();
  const ok = sub && (sub.plan === plan || sub.plan === 'enterprise' || sub.plan === 'lifetime');
  if (ok) return children;
  return (
    <div style={{ position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ filter: 'blur(5px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.55 }}>
        {children}
      </div>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center',
        background: 'rgba(255,255,255,0.35)', backdropFilter: 'blur(1px)', padding: 20,
      }}>
        <div style={{ fontSize: 30 }}>🔒</div>
        <div style={{ fontWeight: 900, fontSize: 16, color: 'var(--text1)' }}>
          {title || 'Pro 전용 기능'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)', maxWidth: 320 }}>
          Pro 플랜을 구독하면 이 기능을 사용할 수 있습니다.
        </div>
        <button onClick={onUpgrade} style={{
          padding: '10px 22px', borderRadius: 24, fontSize: 14, fontWeight: 800, color: '#fff',
          background: 'linear-gradient(135deg, #6366F1, #8B5CF6)', boxShadow: '0 6px 18px rgba(99,102,241,0.4)',
        }}>✨ 업그레이드</button>
      </div>
    </div>
  );
}

// ── 결제 모달 ──────────────────────────────────────────────────────────────
function CheckoutModal({ plan, onClose }) {
  const tier = PRICING[plan];
  const [method, setMethod] = useState('card');   // 'card' | 'crypto'
  const [token, setToken]   = useState('USDC');
  const [phase, setPhase]   = useState('idle');    // idle | sending | pending | done | error
  const [msg, setMsg]       = useState('');
  const [txHash, setTxHash] = useState('');

  if (!tier) return null;

  const permanent = !!tier.oneTime;   // 영구 이용권은 만료 없음
  const close = () => phase === 'sending' || phase === 'pending' ? null : onClose();

  // Stripe 가 설정돼 있으면 실제 결제 페이지로 리다이렉트
  const payCardStripe = () => {
    try {
      setPhase('sending');
      startCardCheckout(plan);
    } catch (e) {
      setPhase('error'); setMsg(e.message);
    }
  };

  // 데모 모드: 카드 폼 입력 → 승인 연출 → 구독 활성화
  const payCardDemo = async (card) => {
    try {
      setPhase('sending');
      const r = await processDemoCardPayment(card);
      activateSubscription({ plan, method: 'card', ref: r.auth, permanent });
      setPhase('done');
      setMsg(`${r.brand || '카드'} •••• ${r.last4} 결제가 완료되었습니다. (데모)`);
    } catch (e) {
      setPhase('error'); setMsg(e?.message || '결제 중 오류가 발생했습니다.');
    }
  };

  const payCrypto = async () => {
    try {
      setPhase('sending'); setMsg('지갑에서 결제를 승인해주세요…');
      const { txHash } = await sendCryptoPayment(plan, token);
      setTxHash(txHash);
      setPhase('pending'); setMsg('트랜잭션 확정을 기다리는 중…');
      const receipt = await waitForReceipt(txHash);
      if (receipt && receipt.status === '0x0') {
        setPhase('error'); setMsg('트랜잭션이 실패했습니다. 다시 시도해주세요.');
        return;
      }
      // 영수증이 확정(성공)되었거나 타임아웃(pending)이어도 결제는 제출됨 → 구독 활성화
      activateSubscription({ plan, method: 'crypto', ref: txHash, permanent });
      setPhase('done');
      setMsg(receipt ? '온체인 결제가 확정되었습니다!' : '결제가 제출되었습니다. 곧 확정됩니다.');
    } catch (e) {
      const m = e?.code === 4001 ? '결제가 취소되었습니다.' : (e?.message || '결제 중 오류가 발생했습니다.');
      setPhase('error'); setMsg(m);
    }
  };

  const overlay = {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 20,
    background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)',
  };
  const card = {
    width: '100%', maxWidth: 440, background: '#fff', borderRadius: 20,
    boxShadow: '0 24px 70px rgba(0,0,0,0.35)', overflow: 'hidden',
  };
  const tabBtn = (active) => ({
    flex: 1, padding: '11px 0', borderRadius: 12, fontSize: 13, fontWeight: 800,
    background: active ? '#fff' : 'transparent',
    color: active ? 'var(--text1)' : 'var(--text3)',
    boxShadow: active ? '0 1px 6px rgba(0,0,0,0.1)' : 'none',
  });

  return (
    <div style={overlay} onClick={close}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div style={{ padding: '20px 24px', background: 'linear-gradient(135deg, #4F46E5, #7C3AED)', color: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700 }}>SRHS 구독</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{tier.name} 플랜</div>
            </div>
            <button onClick={close} style={{ color: '#fff', fontSize: 20, opacity: 0.8, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ marginTop: 10, fontSize: 26, fontWeight: 900 }}>
            ₩{won(tier.priceKRW)}
            <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>
              {permanent ? ' · 1회 결제 (평생)' : ` / ${tier.period}`}
            </span>
            {tier.priceUSDC != null &&
              <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>  ·  ≈ {tier.priceUSDC} USDC</span>}
          </div>
        </div>

        {/* 본문 */}
        <div style={{ padding: '20px 24px' }}>
          {phase === 'done' ? (
            <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
              <div style={{ fontSize: 44 }}>🎉</div>
              <div style={{ fontWeight: 900, fontSize: 18, margin: '8px 0 4px', color: 'var(--text1)' }}>결제 완료</div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>{msg}</div>
              {txHash && (
                <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer"
                   style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: '#4F46E5', wordBreak: 'break-all' }}>
                  영수증(Etherscan) ↗
                </a>
              )}
              <button onClick={onClose} style={{
                marginTop: 18, width: '100%', padding: '12px 0', borderRadius: 12,
                fontSize: 14, fontWeight: 800, color: '#fff',
                background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
              }}>Pro 기능 사용하기</button>
            </div>
          ) : (
            <>
              {/* 결제 수단 탭 */}
              <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg)', borderRadius: 14, marginBottom: 16 }}>
                <button onClick={() => setMethod('card')}   style={tabBtn(method === 'card')}>💳 카드</button>
                <button onClick={() => setMethod('crypto')} style={tabBtn(method === 'crypto')}>🪙 크립토</button>
              </div>

              {method === 'card' ? (
                isStripeConfigured(plan) ? (
                  <>
                    <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, margin: '0 0 16px' }}>
                      Stripe 보안 결제 페이지로 이동합니다. 카드 정보는 Stripe 가 직접 처리하며
                      이 사이트에 저장되지 않습니다.
                    </p>
                    <button onClick={payCardStripe} disabled={phase === 'sending'} style={payBtn}>
                      {phase === 'sending' ? '이동 중…' : `₩${won(tier.priceKRW)} 카드로 결제`}
                    </button>
                  </>
                ) : (
                  <CardForm tier={tier} busy={phase === 'sending'} onSubmit={payCardDemo} />
                )
              ) : (
                <>
                  <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, margin: '0 0 12px' }}>
                    보유한 지갑에서 스테이블코인으로 직접 결제합니다. (Ethereum 메인넷)
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                    {['USDC', 'USDT'].map(t => (
                      <button key={t} onClick={() => setToken(t)} style={{
                        flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 13, fontWeight: 800,
                        border: token === t ? '2px solid #6366F1' : '1.5px solid var(--border)',
                        background: token === t ? '#EEF2FF' : '#fff',
                        color: token === t ? '#4F46E5' : 'var(--text2)',
                      }}>{t} · {tier.priceUSDC}</button>
                    ))}
                  </div>
                  {!hasWallet() && (
                    <div style={warnBox}>⚠️ 이더리움 지갑이 감지되지 않았습니다. MetaMask 등을 설치해주세요.</div>
                  )}
                  {hasWallet() && !isCryptoConfigured() && (
                    <div style={warnBox}>
                      ⚠️ 데모 모드: 가맹점 지갑 주소가 설정되지 않았습니다.
                      <code style={{ display: 'block', marginTop: 4 }}>src/payment.js → CRYPTO.merchant</code>
                    </div>
                  )}
                  <button onClick={payCrypto} disabled={phase === 'sending' || phase === 'pending' || !hasWallet()} style={payBtn}>
                    {phase === 'sending' || phase === 'pending'
                      ? (msg || '처리 중…')
                      : `${tier.priceUSDC} ${token} 로 결제`}
                  </button>
                </>
              )}

              {phase === 'error' && (
                <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--red)', fontWeight: 700, textAlign: 'center' }}>
                  {msg}
                </div>
              )}
              <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.5 }}>
                {permanent
                  ? '1회 결제로 평생 이용 · 추가 비용 없음'
                  : '구독은 결제일로부터 30일간 유효합니다 · 언제든 해지 가능'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const payBtn = {
  width: '100%', padding: '13px 0', borderRadius: 12, fontSize: 15, fontWeight: 800,
  color: '#fff', background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
  boxShadow: '0 8px 20px rgba(79,70,229,0.35)',
};
const warnBox = {
  fontSize: 12, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A',
  borderRadius: 10, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5,
};

// ── 요금제 탭 본문 ─────────────────────────────────────────────────────────
export default function Pricing({ checkoutPlan, onCheckout, onCloseCheckout }) {
  const sub = useSubscription();
  const tiers = [PRICING.free, PRICING.pro, PRICING.lifetime, PRICING.enterprise];
  const lifetime = isLifetime(sub);

  return (
    <div>
      <div style={{ textAlign: 'center', margin: '8px 0 26px' }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: 'var(--text1)', margin: 0 }}>요금제</h2>
        <p style={{ fontSize: 14, color: 'var(--text2)', marginTop: 8 }}>
          스테이블코인 리스크를 더 깊이 모니터링하세요. 카드 또는 스테이블코인으로 결제할 수 있습니다.
        </p>
      </div>

      {sub && sub.plan !== 'free' && (
        <div style={{
          maxWidth: 980, margin: '0 auto 20px', padding: '14px 18px',
          background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 13.5, color: '#3730A3', fontWeight: 700 }}>
            👑 현재 <b>{sub.plan === 'lifetime' ? '영구 이용권' : sub.plan === 'enterprise' ? 'Enterprise' : 'Pro'}</b>
            {lifetime ? ' 보유' : ' 구독 중'} ·
            결제수단 {sub.method === 'crypto' ? '크립토' : '카드'} ·
            {' '}{lifetime ? '평생 이용' : `${daysLeft(sub)}일 남음`}
          </div>
          <button onClick={() => cancelSubscription()} style={{
            padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
            background: '#fff', color: 'var(--red)', border: '1.5px solid #FECACA',
          }}>{lifetime ? '해제' : '구독 해지'}</button>
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 18, maxWidth: 1180, margin: '0 auto',
      }}>
        {tiers.map(tier => {
          const current = (sub?.plan || 'free') === tier.id;
          return (
            <div key={tier.id} style={{
              position: 'relative', background: 'var(--surface)', borderRadius: 'var(--radius)',
              border: tier.popular ? '2px solid #6366F1' : tier.badge ? `2px solid ${tier.accent}` : '1px solid var(--border)',
              boxShadow: tier.popular ? '0 12px 32px rgba(99,102,241,0.18)'
                : tier.badge ? '0 12px 32px rgba(245,158,11,0.18)' : 'var(--shadow)',
              padding: '26px 22px', display: 'flex', flexDirection: 'column',
            }}>
              {(tier.popular || tier.badge) && (
                <div style={{
                  position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                  background: tier.popular ? 'linear-gradient(135deg, #6366F1, #8B5CF6)'
                    : 'linear-gradient(135deg, #F59E0B, #F97316)',
                  color: '#fff', fontSize: 11, fontWeight: 800, padding: '4px 14px', borderRadius: 20, whiteSpace: 'nowrap',
                }}>{tier.popular ? '인기' : tier.badge}</div>
              )}
              <div style={{ fontSize: 13, fontWeight: 800, color: tier.accent }}>{tier.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>{tier.tagline}</div>
              <div style={{ margin: '14px 0 4px', fontSize: 30, fontWeight: 900, color: 'var(--text1)' }}>
                {tier.priceKRW == null ? '문의'
                  : tier.priceKRW === 0 ? '무료'
                  : <>₩{won(tier.priceKRW)}<span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text3)' }}>{tier.oneTime ? ' · 1회' : ` /${tier.period}`}</span></>}
              </div>
              {tier.priceUSDC != null && tier.priceUSDC > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>≈ {tier.priceUSDC} USDC {tier.oneTime ? '· 1회' : `/ ${tier.period}`}</div>
              )}

              <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 22px', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
                {tier.features.map((f, i) => (
                  <li key={i} style={{ fontSize: 13, color: 'var(--text2)', display: 'flex', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: tier.accent, fontWeight: 900 }}>✓</span>{f}
                  </li>
                ))}
              </ul>

              {tier.id === 'free' ? (
                <button disabled style={{
                  padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 800,
                  background: 'var(--bg)', color: 'var(--text3)', cursor: 'default',
                }}>{current ? '현재 플랜' : '기본 제공'}</button>
              ) : tier.id === 'enterprise' ? (
                <a href={tier.contact} style={{
                  padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 800, textAlign: 'center',
                  background: '#fff', color: tier.accent, border: `1.5px solid ${tier.accent}`,
                }}>영업팀 문의</a>
              ) : (
                <button onClick={() => onCheckout(tier.id)} disabled={current} style={{
                  padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 800, color: '#fff',
                  background: current ? '#CBD5E1'
                    : tier.oneTime ? 'linear-gradient(135deg, #F59E0B, #F97316)'
                    : 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                  boxShadow: current ? 'none'
                    : tier.oneTime ? '0 8px 20px rgba(245,158,11,0.3)' : '0 8px 20px rgba(79,70,229,0.3)',
                  cursor: current ? 'default' : 'pointer',
                }}>{current ? '이용 중' : tier.oneTime ? '평생 이용권 구매' : '구독하기'}</button>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--text3)', marginTop: 24, lineHeight: 1.6 }}>
        결제는 Stripe(카드) 및 Ethereum 메인넷 USDC/USDT(온체인)로 처리됩니다.<br />
        SRHS 점수는 정보 제공용이며 투자 자문이 아닙니다.
      </p>

      {checkoutPlan && <CheckoutModal plan={checkoutPlan} onClose={onCloseCheckout} />}
    </div>
  );
}
