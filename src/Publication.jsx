// ── 학회 발간 탭 ───────────────────────────────────────────────────────────
// 수상 사진 썸네일 카드 → 클릭하면 논문·PPT·사진을 모두 보여주고,
// 논문(HWP)과 PPT(PPTX)는 다운로드할 수 있다.
import { useState } from 'react';

const BASE = import.meta.env.BASE_URL;        // dev: '/', build: '/payment/'

const ASSETS = {
  thumb: `${BASE}publication/award_thumb.jpg`,
  photo: `${BASE}publication/award.jpg`,
  paper: `${BASE}publication/paper.hwp`,
  ppt:   `${BASE}publication/slides.pptx`,
};

// 다운로드 시 사용자에게 저장될 한글 파일명
const PAPER_NAME = 'B2B 무역결제 스테이블코인 안정성 평가 모델_논문.hwp';
const PPT_NAME   = '스테이블코인 실시간 건전성 지수(SRHS) 발표자료_오성준.pptx';

const META = {
  title:    'AX 시대, 경영컨설팅의 실천적 과제',
  conf:     '(사)한국경영컨설팅학회 2026 춘계학술대회 · 대학생경진대회',
  award:    '최우수상',
  paperTitle: 'B2B 무역결제 스테이블코인 안정성 평가 모델 개발',
  pptTitle:   '스테이블 코인 실시간 건전성 지수(SRHS)가 B2B 무역결제 리스크 관리에 미치는 영향',
  author:   '오성준',
};

// 다운로드 카드(논문/PPT 공용)
function FileCard({ emoji, kind, name, size, href, download, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, boxShadow: 'var(--shadow)',
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 12, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, background: `${accent}1A`,
      }}>{emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: 0.4 }}>{kind}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text1)', lineHeight: 1.4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{size}</div>
      </div>
      <a href={href} download={download} style={{
        flexShrink: 0, padding: '9px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800,
        color: '#fff', background: accent, textDecoration: 'none', whiteSpace: 'nowrap',
      }}>⤓ 다운로드</a>
    </div>
  );
}

// 발간물 상세 모달
function PublicationModal({ onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
      alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto',
      background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 760, background: 'var(--bg)', borderRadius: 20,
        boxShadow: '0 24px 70px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}>
        {/* 헤더 */}
        <div style={{ padding: '20px 26px', background: 'linear-gradient(135deg, #4F46E5, #7C3AED)', color: '#fff',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700 }}>학회 발간물</div>
            <div style={{ fontSize: 20, fontWeight: 900, marginTop: 2 }}>🏆 {META.award} 수상작</div>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>{META.conf}</div>
          </div>
          <button onClick={onClose} style={{ color: '#fff', fontSize: 22, opacity: 0.85, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 사진 */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', marginBottom: 8, letterSpacing: 0.5 }}>📷 수상 사진</div>
            <img src={ASSETS.photo} alt="수상 사진"
              style={{ width: '100%', borderRadius: 14, boxShadow: 'var(--shadow)', display: 'block' }} />
          </div>

          {/* 논문 */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', marginBottom: 8, letterSpacing: 0.5 }}>📄 논문</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text1)', marginBottom: 10, lineHeight: 1.5 }}>
              {META.paperTitle}
            </div>
            <FileCard emoji="📄" kind="논문 · HWP" name={PAPER_NAME} size="한글 문서 · 약 164 KB"
              href={ASSETS.paper} download={PAPER_NAME} accent="#2563EB" />
          </div>

          {/* PPT */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text3)', marginBottom: 8, letterSpacing: 0.5 }}>📊 발표자료</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text1)', marginBottom: 10, lineHeight: 1.5 }}>
              {META.pptTitle}
            </div>
            <FileCard emoji="📊" kind="발표자료 · PPTX" name={PPT_NAME} size="PowerPoint · 약 17.4 MB"
              href={ASSETS.ppt} download={PPT_NAME} accent="#DC2626" />
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--text3)', textAlign: 'center', lineHeight: 1.6, marginTop: 4 }}>
            논문(HWP)·발표자료(PPTX)는 브라우저에서 미리보기가 지원되지 않아 다운로드로 제공됩니다.<br />
            발표자: {META.author} · {META.conf}
          </div>
        </div>
      </div>
    </div>
  );
}

// 발간 탭 본문
export default function Publication() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div style={{ textAlign: 'center', margin: '8px 0 26px' }}>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: 'var(--text1)', margin: 0 }}>학회 발간</h2>
        <p style={{ fontSize: 14, color: 'var(--text2)', marginTop: 8 }}>
          SRHS 연구가 수록된 학회 발간물입니다. 클릭하면 논문·발표자료·수상 사진을 확인하고 내려받을 수 있습니다.
        </p>
      </div>

      {/* 썸네일 카드 (클릭 가능) */}
      <div
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(true)}
        style={{
          maxWidth: 520, margin: '0 auto', cursor: 'pointer',
          background: 'var(--surface)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 14px 36px rgba(0,0,0,0.16)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
      >
        {/* 썸네일 사진 */}
        <div style={{ position: 'relative' }}>
          <img src={ASSETS.thumb} alt="학회 발간 썸네일"
            style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover' }} />
          <div style={{
            position: 'absolute', top: 12, left: 12, padding: '5px 12px', borderRadius: 20,
            background: 'linear-gradient(135deg, #F59E0B, #F97316)', color: '#fff',
            fontSize: 12, fontWeight: 900, boxShadow: '0 4px 12px rgba(245,158,11,0.4)',
          }}>🏆 {META.award}</div>
        </div>
        {/* 카드 본문 */}
        <div style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#6366F1', letterSpacing: 0.4 }}>학회 발간</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: 'var(--text1)', marginTop: 3, lineHeight: 1.4 }}>
            {META.pptTitle}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 6 }}>{META.conf}</div>
          <button style={{
            marginTop: 14, width: '100%', padding: '12px 0', borderRadius: 12,
            fontSize: 14, fontWeight: 800, color: '#fff',
            background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
            boxShadow: '0 8px 20px rgba(79,70,229,0.3)',
          }}>📖 발간물 보기 (논문 · PPT · 사진)</button>
        </div>
      </div>

      {open && <PublicationModal onClose={() => setOpen(false)} />}
    </div>
  );
}
