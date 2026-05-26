# -*- coding: utf-8 -*-
"""
SRHS 스테이블코인 4종 검증 스크립트
- CoinGecko / DeFiLlama API 실시간 데이터
- scoring.js 동일 알고리즘 Python 포팅
- III장 시나리오 A0~A4 비교 + 민감도 분석 + 리포트 출력
"""

import sys
import time
import math
import requests
import json
from datetime import datetime

# matplotlib 한글 설정
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.font_manager as fm
    import numpy as np

    # 한글 폰트 (Windows)
    for font in ["Malgun Gothic", "NanumGothic", "AppleGothic", "DejaVu Sans"]:
        if any(font.lower() in f.name.lower() for f in fm.fontManager.ttflist):
            plt.rcParams["font.family"] = font
            break
    plt.rcParams["axes.unicode_minus"] = False
    HAS_PLOT = True
except ImportError:
    HAS_PLOT = False
    print("[경고] matplotlib/numpy 없음 — 그래프 생략, 텍스트 출력만 수행")

# ── 상수 ──────────────────────────────────────────────────────────────────────

CG_BASE = "https://api.coingecko.com/api/v3"

COIN_IDS = {
    "USDT":  "tether",
    "USDC":  "usd-coin",
    "DAI":   "dai",
    "PYUSD": "paypal-usd",
}

# 고정 점수 (scoring.js 동일)
TI_SCORES   = {"USDT": 44, "USDC": 94, "DAI": 88, "PYUSD": 72}
RR_SCORES   = {"USDT": 55, "USDC": 14, "DAI": 28, "PYUSD": 18}
CR_BASELINE = {"USDT": 0.62, "USDC": 0.92, "PYUSD": 0.78}  # DAI는 실시간

# III장 3-5절 시나리오 A0~A4
SCENARIOS = {
    "A0 베이스라인":      {"PD": 0.20, "LS": 0.20, "CR": 0.25, "TI": 0.20, "RR": 0.15},
    "A1 시장리스크 강조": {"PD": 0.30, "LS": 0.30, "CR": 0.20, "TI": 0.10, "RR": 0.10},
    "A2 담보건전성 강조": {"PD": 0.15, "LS": 0.15, "CR": 0.40, "TI": 0.15, "RR": 0.15},
    "A3 규제투명성 강조": {"PD": 0.15, "LS": 0.15, "CR": 0.15, "TI": 0.25, "RR": 0.30},
    "A4 균등(통제군)":    {"PD": 0.20, "LS": 0.20, "CR": 0.20, "TI": 0.20, "RR": 0.20},
}

COIN_COLORS = {"USDC": "#2563EB", "DAI": "#F59E0B", "PYUSD": "#7C3AED", "USDT": "#16A34A"}
SYMS = ["USDC", "DAI", "PYUSD", "USDT"]

# ── API ───────────────────────────────────────────────────────────────────────

def safe_get(url, retries=2):
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=15)
            if r.status_code == 429:
                print("  [rate limit] 8초 대기...")
                time.sleep(8)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(3)

def fetch_current():
    ids  = ",".join(COIN_IDS.values())
    data = safe_get(f"{CG_BASE}/coins/markets?vs_currency=usd&ids={ids}")
    result = {}
    for coin in data:
        sym = next((k for k, v in COIN_IDS.items() if v == coin["id"]), None)
        if sym:
            result[sym] = {
                "price":      coin["current_price"],
                "volume24h":  coin["total_volume"],
                "supply":     coin["circulating_supply"],
                "market_cap": coin["market_cap"],
            }
    return result

def fetch_volumes30d(symbol):
    cid  = COIN_IDS[symbol]
    data = safe_get(f"{CG_BASE}/coins/{cid}/market_chart?vs_currency=usd&days=30&interval=daily")
    return [v[1] for v in data["total_volumes"]]

def fetch_dai_cr(dai_supply):
    try:
        data     = safe_get("https://api.llama.fi/protocol/makerdao")
        tvl_list = data.get("tvl", [])
        tvl      = tvl_list[-1]["totalLiquidityUSD"] if tvl_list else 0
        return tvl / dai_supply if dai_supply else 1.40
    except:
        return 1.40

# ── 점수 계산 ─────────────────────────────────────────────────────────────────

def pd_score(price):
    return min((abs(price - 1.0) / 0.02) * 100, 100)

def ls_score(current_vol, vols30d):
    if not vols30d:
        return 0
    mean = sum(vols30d) / len(vols30d)
    std  = math.sqrt(sum((v - mean) ** 2 for v in vols30d) / len(vols30d))
    z    = (current_vol - mean) / std if std > 0 else 0
    return min(max(z, 0), 3.0) / 3.0 * 100

def cr_score(cr_ratio):
    return max(0, 100 - min(cr_ratio * 100, 200))

def ti_score(sym):
    return 100 - TI_SCORES.get(sym, 50)

def rr_score(sym):
    return RR_SCORES.get(sym, 50)

def srhs_total(scores, weights):
    return sum(scores[k] * weights[k] for k in weights)

def get_grade(score):
    if score <= 30: return "LOW",      "GREEN",  "정상 - 계속 사용 가능"
    if score <= 55: return "CAUTION",  "YELLOW", "주의 - 모니터링 강화"
    if score <= 75: return "HIGH",     "ORANGE", "위험 - 교체 검토"
    return               "CRITICAL", "RED",    "즉시 교체 권고"

GRADE_EMOJI = {"LOW": "[OK]", "CAUTION": "[!!]", "HIGH": "[HI]", "CRITICAL": "[!!]"}

# ── 민감도 분석 ───────────────────────────────────────────────────────────────

SIGMA_FIXED = {"PD": 5.0, "CR": 10.0, "TI": 8.0, "RR": 7.0}

def calc_ls_sigma(vols30d):
    mean = sum(vols30d) / len(vols30d)
    std  = math.sqrt(sum((v - mean) ** 2 for v in vols30d) / len(vols30d))
    return min((std / mean) * 100, 30.0) if mean > 0 else 10.0

def sensitivity_analysis(base_scores, weights, sigma_map):
    base_srhs = srhs_total(base_scores, weights)
    results = {}
    for metric in ["PD", "LS", "CR", "TI", "RR"]:
        sigma = sigma_map[metric]
        row = {}
        for shock in [-2, -1, 0, 1, 2]:
            shocked = dict(base_scores)
            shocked[metric] = max(0.0, min(100.0, base_scores[metric] + shock * sigma))
            row[shock] = round(srhs_total(shocked, weights) - base_srhs, 2)
        results[metric] = row
    return results

# ── 그래프 ────────────────────────────────────────────────────────────────────

def plot_scenario_comparison(scenario_results, out_path):
    fig, ax = plt.subplots(figsize=(11, 5))
    sc_names = list(scenario_results.keys())
    x = np.arange(len(sc_names))
    width = 0.18
    for i, sym in enumerate(SYMS):
        vals = [scenario_results[sc][sym] for sc in sc_names]
        bars = ax.bar(x + i * width, vals, width, label=sym,
                      color=COIN_COLORS[sym], alpha=0.85, edgecolor="white")
        for bar, v in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5,
                    f"{v:.0f}", ha="center", va="bottom", fontsize=7.5, fontweight="bold")

    ax.axhline(76, color="red",    linestyle="--", linewidth=1.2, label="CRITICAL 임계치 (76)")
    ax.axhline(55, color="orange", linestyle=":",  linewidth=1.0, label="CAUTION 임계치 (55)")
    ax.axhline(30, color="green",  linestyle=":",  linewidth=1.0, label="LOW 임계치 (30)")
    ax.set_xticks(x + width * 1.5)
    ax.set_xticklabels(sc_names, fontsize=9)
    ax.set_ylabel("SRHS 점수 (0=안전, 100=위험)")
    ax.set_title("시나리오별 SRHS 비교 (A0~A4)", fontsize=12, fontweight="bold")
    ax.set_ylim(0, 110)
    ax.legend(fontsize=8, loc="upper right")
    ax.grid(axis="y", alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150)
    plt.close()
    print(f"  저장: {out_path}")

def plot_breakdown_heatmap(raw_scores, a0_scores, out_path):
    metrics = ["PD", "LS", "CR", "TI", "RR"]
    data = np.array([[raw_scores[s][m] for m in metrics] for s in SYMS])

    fig, ax = plt.subplots(figsize=(8, 4))
    im = ax.imshow(data, cmap="RdYlGn_r", vmin=0, vmax=100, aspect="auto")
    ax.set_xticks(range(len(metrics)))
    ax.set_xticklabels(metrics, fontsize=11, fontweight="bold")
    ax.set_yticks(range(len(SYMS)))
    ax.set_yticklabels(SYMS, fontsize=11)
    for i, sym in enumerate(SYMS):
        for j, m in enumerate(metrics):
            v = raw_scores[sym][m]
            ax.text(j, i, f"{v:.1f}", ha="center", va="center",
                    fontsize=10, fontweight="bold",
                    color="white" if v > 60 else "black")
    ax.set_title("지표별 원점수 히트맵 (0=안전/녹색, 100=위험/빨강)", fontsize=11)
    plt.colorbar(im, ax=ax, fraction=0.03, pad=0.02)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150)
    plt.close()
    print(f"  저장: {out_path}")

def plot_tornado(sensitivity_all, out_path):
    fig, axes = plt.subplots(1, 4, figsize=(14, 4), sharey=True)
    metrics = ["PD", "LS", "CR", "TI", "RR"]
    colors_pos = "#EF4444"
    colors_neg = "#3B82F6"

    for ax, sym in zip(axes, SYMS):
        sens = sensitivity_all[sym]
        max_abs = {m: max(abs(sens[m][shock]) for shock in [-2, -1, 1, 2]) for m in metrics}
        sorted_metrics = sorted(metrics, key=lambda m: max_abs[m])

        for i, m in enumerate(sorted_metrics):
            pos = sens[m][2]
            neg = sens[m][-2]
            ax.barh(i, pos, color=colors_pos, alpha=0.8, height=0.4, label="+2sigma" if i == 0 else "")
            ax.barh(i, neg, color=colors_neg, alpha=0.8, height=0.4, label="-2sigma" if i == 0 else "")

        ax.set_yticks(range(len(sorted_metrics)))
        ax.set_yticklabels(sorted_metrics, fontsize=10)
        ax.axvline(0, color="black", linewidth=0.8)
        ax.set_title(sym, fontsize=11, fontweight="bold")
        ax.set_xlabel("DELTA SRHS")
        ax.grid(axis="x", alpha=0.3)

    axes[0].legend(fontsize=8)
    fig.suptitle("토네이도 차트: 지표별 +-2sigma 충격 -> DELTA SRHS", fontsize=12, fontweight="bold")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150)
    plt.close()
    print(f"  저장: {out_path}")

def plot_radar(raw_scores, a0_scores, out_path):
    metrics = ["PD", "LS", "CR", "TI", "RR"]
    N = len(metrics)
    angles = [n / float(N) * 2 * math.pi for n in range(N)]
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(6, 6), subplot_kw={"polar": True})
    for sym in SYMS:
        vals = [raw_scores[sym][m] for m in metrics]
        vals += vals[:1]
        ax.plot(angles, vals, linewidth=2, label=sym, color=COIN_COLORS[sym])
        ax.fill(angles, vals, alpha=0.08, color=COIN_COLORS[sym])

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(metrics, fontsize=11)
    ax.set_ylim(0, 100)
    ax.set_yticks([20, 40, 60, 80, 100])
    ax.set_yticklabels(["20", "40", "60", "80", "100"], fontsize=7)
    ax.set_title("지표별 원점수 레이더 차트", fontsize=12, fontweight="bold", pad=15)
    ax.legend(loc="upper right", bbox_to_anchor=(1.3, 1.1), fontsize=9)
    plt.tight_layout()
    plt.savefig(out_path, dpi=150)
    plt.close()
    print(f"  저장: {out_path}")

# ── Spearman 순위 안정성 ──────────────────────────────────────────────────────

def spearman(r1, r2):
    n  = len(r1)
    d2 = sum((a - b) ** 2 for a, b in zip(r1, r2))
    return 1 - (6 * d2) / (n * (n ** 2 - 1))

def get_rank(scores_dict):
    sorted_syms = sorted(SYMS, key=lambda s: scores_dict[s])
    return [sorted_syms.index(s) + 1 for s in SYMS]

# ── 리포트 생성 ───────────────────────────────────────────────────────────────

def write_report(raw_scores, current, scenario_results, sensitivity_all, cr_ratios, run_at, out_path):
    a0 = SCENARIOS["A0 베이스라인"]
    lines = []
    lines.append(f"# SRHS 검증 리포트\n")
    lines.append(f"생성 시각: {run_at}  \n\n")

    lines.append("## 1. 실시간 데이터 (CoinGecko)\n\n")
    lines.append("| 자산 | 현재가 | 24h 거래량 | 유통량 | 준비금 비율 |\n")
    lines.append("|------|--------|------------|--------|-------------|\n")
    for sym in SYMS:
        d = current[sym]
        cr = cr_ratios[sym]
        lines.append(f"| {sym} | ${d['price']:.6f} | ${d['volume24h']:,.0f} | "
                     f"{d['supply']:,.0f} | {cr:.1%} |\n")
    lines.append("\n")

    lines.append("## 2. 지표별 원점수\n\n")
    lines.append("| 자산 | PD | LS | CR | TI | RR | SRHS(A0) | 등급 |\n")
    lines.append("|------|----|----|----|----|-----|----------|------|\n")
    for sym in SYMS:
        s = raw_scores[sym]
        total = srhs_total(s, a0)
        grade, _, desc = get_grade(total)
        lines.append(f"| {sym} | {s['PD']:.1f} | {s['LS']:.1f} | {s['CR']:.1f} | "
                     f"{s['TI']:.1f} | {s['RR']:.1f} | **{total:.1f}** | {grade} |\n")
    lines.append("\n")

    lines.append("## 3. 시나리오 비교 (A0~A4)\n\n")
    lines.append("| 시나리오 | USDC | DAI | PYUSD | USDT | Spearman ρ vs A0 |\n")
    lines.append("|----------|------|-----|-------|------|------------------|\n")
    base_rank = get_rank({s: scenario_results["A0 베이스라인"][s] for s in SYMS})
    for sc_name, sc_scores in scenario_results.items():
        sc_rank = get_rank(sc_scores)
        rho = spearman(base_rank, sc_rank)
        rho_str = f"{rho:.3f} ({'강건' if rho >= 0.7 else '불안정'})"
        lines.append(f"| {sc_name} | {sc_scores['USDC']:.1f} | {sc_scores['DAI']:.1f} | "
                     f"{sc_scores['PYUSD']:.1f} | {sc_scores['USDT']:.1f} | {rho_str} |\n")
    lines.append("\n")

    lines.append("## 4. 민감도 분석 (RQ2) — 가장 민감한 지표\n\n")
    lines.append("| 자산 | 가장 민감한 지표 | 최대 |DELTA SRHS| |\n")
    lines.append("|------|----------------|------------------|\n")
    for sym in SYMS:
        sens = sensitivity_all[sym]
        max_abs = {m: max(abs(sens[m][s]) for s in [-2, -1, 1, 2]) for m in ["PD","LS","CR","TI","RR"]}
        top = max(max_abs, key=max_abs.get)
        lines.append(f"| {sym} | **{top}** | {max_abs[top]:.2f}점 |\n")
    lines.append("\n")

    lines.append("## 5. 알고리즘 설계 근거\n\n")
    lines.append("""### 기존 방식과의 비교

| 구분 | 기존 접근 (단순 가중합) | SRHS 설계 | 근거 |
|------|----------------------|-----------|------|
| PD 계산 | 단순 가격 이탈 % | `|price-1| / 0.02 * 100` 선형 정규화 | 2% 이탈 = 만점 100으로 감도 극대화 |
| LS 계산 | 거래량 절대값 비교 | Z-score 기반 + 상한 3.0 클리핑 | 코인별 유통량 규모 차이 제거, 이상 거래 탐지 |
| CR 계산 | 준비금 비율 직접 사용 | `max(0, 100 - cr*100)` 역선형 | 100% 담보 = 0점(안전), 0% = 100점(위험) 직관적 역매핑 |
| TI/RR | 실시간 미계산 | 정성 평가 고정값 + 역산 | MiCA EMT 기준, CARF 가입 여부 등 제도 기반 고정 |
| 종합 | 단순 평균 | Ridge Regression 최적 가중치 합산 | FTX·테라루나 사후 역산으로 CR 25% 우선순위 도출 |

### Z-score 선택 이유 (LS)
단순 거래량 비교는 USDT(시총 1위)와 PYUSD(소형)의 절대 거래량 차이가 100배 이상이므로
동일 척도로 비교 불가능. Z-score는 각 코인의 30일 분포 기준 상대적 이상치를 측정하여
유통량 편향 없이 패닉셀 전조를 감지함.

### CR 역매핑 이유
담보비율이 높을수록 위험 점수가 낮아야 하므로 역선형 변환 적용.
200% 초과 시 0점으로 클리핑하여 과담보 코인(DAI 140%+)의 위험 과소평가를 방지.
""")

    with open(out_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print(f"  저장: {out_path}")

# ── 메인 ──────────────────────────────────────────────────────────────────────

def main():
    run_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    OUT = "c:/Users/sungj/OneDrive/Desktop/스테이블콩ㄴ/SRHS-STABLECOIN-RISK-HEALTH-SCORE-/validation"

    print()
    print("=" * 68)
    print("  SRHS 스테이블코인 4종 실험 검증")
    print(f"  실행 시각: {run_at}")
    print("=" * 68)

    # 1. 데이터 수집
    print("\n[1/5] CoinGecko API 데이터 수집 중...")
    current = fetch_current()
    print(f"  현재가: " + ", ".join(f"{s}=${current[s]['price']:.5f}" for s in SYMS))

    print("  30일 거래량 수집 (코인당 2초 간격)...")
    vols30d = {}
    for sym in COIN_IDS:
        vols30d[sym] = fetch_volumes30d(sym)
        print(f"  {sym}: {len(vols30d[sym])}일 완료")
        time.sleep(2)

    print("  DAI 담보비율 (DeFiLlama)...")
    dai_cr = fetch_dai_cr(current["DAI"]["supply"])
    print(f"  DAI CR = {dai_cr:.2%}")

    cr_ratios = {**CR_BASELINE, "DAI": dai_cr}

    # 2. 원점수 계산
    print("\n[2/5] SRHS 원점수 계산...")
    raw_scores = {}
    sigma_map  = {}
    for sym in SYMS:
        d  = current[sym]
        pd = pd_score(d["price"])
        ls = ls_score(d["volume24h"], vols30d[sym])
        cr = cr_score(cr_ratios[sym])
        ti = ti_score(sym)
        rr = rr_score(sym)
        raw_scores[sym] = {"PD": pd, "LS": ls, "CR": cr, "TI": ti, "RR": rr}
        sigma_map[sym]  = {**SIGMA_FIXED, "LS": calc_ls_sigma(vols30d[sym])}

    print()
    print(f"  {'자산':6s} | {'PD':>5} {'LS':>5} {'CR':>5} {'TI':>5} {'RR':>5} | SRHS  | 등급")
    print("-" * 60)
    a0 = SCENARIOS["A0 베이스라인"]
    for sym in SYMS:
        s = raw_scores[sym]
        total = srhs_total(s, a0)
        grade, _, desc = get_grade(total)
        print(f"  {sym:6s} | {s['PD']:5.1f} {s['LS']:5.1f} {s['CR']:5.1f} {s['TI']:5.1f} {s['RR']:5.1f} | {total:5.1f} | {grade} {desc}")

    # 3. 시나리오 A0~A4
    print("\n[3/5] 시나리오 가중치 비교 (RQ1)...")
    print()
    print(f"  {'시나리오':<22} | {'USDC':>5} {'DAI':>5} {'PYUSD':>6} {'USDT':>5} | rho vs A0")
    print("-" * 68)

    scenario_results = {}
    base_rank = None
    for sc_name, weights in SCENARIOS.items():
        sc_scores = {sym: round(srhs_total(raw_scores[sym], weights), 1) for sym in SYMS}
        scenario_results[sc_name] = sc_scores
        sc_rank = get_rank(sc_scores)
        if base_rank is None:
            base_rank = sc_rank
            rho_str = "  (기준)"
        else:
            rho = spearman(base_rank, sc_rank)
            stable = "강건" if rho >= 0.7 else "불안정"
            rho_str = f"  rho={rho:.3f} ({stable})"
        print(f"  {sc_name:<22} | {sc_scores['USDC']:5.1f} {sc_scores['DAI']:5.1f} "
              f"{sc_scores['PYUSD']:6.1f} {sc_scores['USDT']:5.1f} |{rho_str}")

    # 4. 민감도 분석
    print("\n[4/5] 민감도 분석 +-1σ/+-2σ (RQ2)...")
    sensitivity_all = {}
    for sym in SYMS:
        sensitivity_all[sym] = sensitivity_analysis(raw_scores[sym], a0, sigma_map[sym])

    for sym in SYMS:
        base = srhs_total(raw_scores[sym], a0)
        sens = sensitivity_all[sym]
        print(f"\n  {sym} (기준 SRHS: {base:.1f})")
        print(f"  {'지표':4s} | {'-2s':>7} {'-1s':>7} {'0':>7} {'+1s':>7} {'+2s':>7} | 최대|DELTA|")
        print("  " + "-" * 58)
        max_impact = {}
        for m in ["PD", "LS", "CR", "TI", "RR"]:
            v = [sens[m][s] for s in [-2, -1, 0, 1, 2]]
            mx = max(abs(x) for x in v)
            max_impact[m] = mx
            print(f"  {m:4s} | {v[0]:>+7.2f} {v[1]:>+7.2f} {v[2]:>+7.2f} {v[3]:>+7.2f} {v[4]:>+7.2f} | {mx:.2f}")
        top = max(max_impact, key=max_impact.get)
        print(f"  -> 가장 민감한 지표: {top} (최대 {max_impact[top]:.2f}점 변동)")

    # 5. 그래프 & 리포트
    print("\n[5/5] 그래프 & 리포트 저장 중...")
    if HAS_PLOT:
        plot_scenario_comparison(scenario_results, f"{OUT}/graph_scenario.png")
        plot_breakdown_heatmap(raw_scores, {s: srhs_total(raw_scores[s], a0) for s in SYMS},
                               f"{OUT}/graph_heatmap.png")
        plot_tornado(sensitivity_all, f"{OUT}/graph_tornado.png")
        plot_radar(raw_scores, {s: srhs_total(raw_scores[s], a0) for s in SYMS},
                   f"{OUT}/graph_radar.png")
    else:
        print("  matplotlib 없어 그래프 생략")

    write_report(raw_scores, current, scenario_results, sensitivity_all, cr_ratios, run_at,
                 f"{OUT}/report.md")

    # 최종 요약
    print()
    print("=" * 68)
    print("  최종 현황 - A0 베이스라인")
    print("=" * 68)
    sorted_syms = sorted(SYMS, key=lambda s: srhs_total(raw_scores[s], a0))
    for sym in sorted_syms:
        score = srhs_total(raw_scores[sym], a0)
        grade, _, desc = get_grade(score)
        bar = "#" * int(score / 2)
        print(f"  {sym:6s} [{bar:<50}] {score:5.1f} | {grade} {desc}")
    print()
    critical = [s for s in SYMS if srhs_total(raw_scores[s], a0) >= 76]
    print(f"  CRITICAL(>=76) 자산: {', '.join(critical) if critical else '없음'}")
    print(f"\n  출력 파일: {OUT}/")
    print("  - graph_scenario.png  (시나리오 비교 막대)")
    print("  - graph_heatmap.png   (지표별 히트맵)")
    print("  - graph_tornado.png   (민감도 토네이도)")
    print("  - graph_radar.png     (레이더 차트)")
    print("  - report.md           (전체 리포트)")
    print()


if __name__ == "__main__":
    main()
