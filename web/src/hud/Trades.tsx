import { isTradeable, itemById, type Side, TRADE_COINS_CAP } from "@tokenmaxxing/core/shop.ts";
import type { Trade } from "@tokenmaxxing/server/registry";
import { useEffect, useState } from "react";
import { errorText, refreshMe, town } from "../net.ts";
import { hud, useHud } from "../store.ts";
import { Modal, useRun } from "./ui.tsx";

/** "🪙 50 + Shades", or "nothing". */
const sideText = (s: Side): string =>
  [...(s.coins ? [`🪙 ${s.coins}`] : []), ...s.items.map((id) => itemById(id)?.name ?? id)].join(" + ") ||
  "nothing";

/** Offering someone a trade, from their card: coins and items each way. */
export function TradePanel({ userId }: { userId: number }) {
  const wallet = useHud((s) => s.wallet);
  /** What I could give: my bag, less rewards and what's in my office. */
  const [mine, setMine] = useState<Record<string, number> | null>(null);
  const [them, setThem] = useState<{ name: string; owned: string[] } | null>(null);
  const [give, setGive] = useState<Side>({ coins: 0, items: [] });
  const [want, setWant] = useState<Side>({ coins: 0, items: [] });
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const { error, busy, run } = useRun();
  useEffect(() => {
    void town.wallet().then((w) => hud.set({ wallet: w }));
    void town
      .bag()
      .then((b) =>
        setMine(
          Object.fromEntries(
            b
              .filter((r) => isTradeable(r.item) && r.count > r.placed)
              .map((r) => [r.item, r.count - r.placed]),
          ),
        ),
      );
    void town.tradeables(userId).then(setThem, (e) => setFailed(errorText(e)));
  }, [userId]);
  if (failed) return <Modal title="🔁 Trade">{failed}</Modal>;
  if (!wallet || !mine || !them) return <Modal title="🔁 Trade">Loading…</Modal>;

  const offer = run(async () => {
    setSent(false);
    await town.offerTrade(userId, give, want);
    setSent(true);
  });
  return (
    <Modal title={`🔁 Trade with ${them.name}`}>
      <p className="muted small">
        You have 🪙 {wallet.balance.toLocaleString()}. They accept or decline, and both sides move at once.
      </p>
      <form className="table-form" onSubmit={offer}>
        <div className="trade-sides">
          <SideFields
            legend="You give"
            side={give}
            items={Object.keys(mine)}
            counts={mine}
            onChange={setGive}
          />
          <SideFields legend="You get" side={want} items={them.owned} onChange={setWant} />
        </div>
        <button
          type="submit"
          className="primary"
          disabled={busy || give.coins > TRADE_COINS_CAP || want.coins > TRADE_COINS_CAP}
        >
          Offer
        </button>
      </form>
      {sent && <p>Sent. They'll get a toast.</p>}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

/** One side of an offer: a coins box and the items to pick from (with how many, when known). */
function SideFields({
  legend,
  side,
  items,
  counts,
  onChange,
}: {
  legend: string;
  side: Side;
  items: string[];
  counts?: Record<string, number>;
  onChange: (s: Side) => void;
}) {
  const toggle = (id: string) =>
    onChange({
      ...side,
      items: side.items.includes(id) ? side.items.filter((i) => i !== id) : [...side.items, id],
    });
  return (
    // A fieldset, not a label: clicking a label's text would press its first item.
    <fieldset>
      <legend>{legend}</legend>
      <label>
        Coins (up to 🪙 {TRADE_COINS_CAP})
        <input
          type="number"
          min={0}
          max={TRADE_COINS_CAP}
          value={side.coins}
          onChange={(e) =>
            onChange({
              ...side,
              coins: Math.max(0, Math.floor(Number(e.target.value)) || 0),
            })
          }
        />
      </label>
      {side.coins > TRADE_COINS_CAP && <small className="error">Up to 🪙 {TRADE_COINS_CAP}</small>}
      {items.length > 0 ? (
        <div className="pills">
          {items.map((id) => (
            <button key={id} type="button" aria-pressed={side.items.includes(id)} onClick={() => toggle(id)}>
              {itemById(id)?.name ?? id}
              {counts && ` ×${counts[id]}`}
            </button>
          ))}
        </div>
      ) : (
        <small className="muted">No items to trade.</small>
      )}
    </fieldset>
  );
}

/** Offers to me, to accept or decline, and my own, to withdraw. */
export function TradesPanel() {
  const [list, setList] = useState<{ incoming: Trade[]; outgoing: Trade | null } | null>(null);
  const { error, run: call } = useRun();
  useEffect(() => {
    void town.trades().then(setList, () => setList({ incoming: [], outgoing: null }));
    // ponytail: a poll, not an event; an offer withdrawn under you is rare.
    const id = setInterval(() => void town.trades().then(setList, () => {}), 10_000);
    return () => clearInterval(id);
  }, []);
  // Whatever happened, show what's open now.
  const run = (fn: () => Promise<unknown>) =>
    call(async () => {
      try {
        await fn();
      } finally {
        setList(await town.trades());
      }
    });
  if (!list) return <Modal title="🔁 Trades">Loading…</Modal>;

  const out = list.outgoing;
  return (
    <Modal title="🔁 Trades">
      <h3>Offers to you</h3>
      {list.incoming.length === 0 ? (
        <p className="muted small">None right now. Offer one from someone's card.</p>
      ) : (
        <>
          <p className="muted small">What they give ⇄ what they want from you.</p>
          <ul className="members">
            {list.incoming.map((t) => (
              <li key={t.fromId}>
                <span>
                  <strong>{t.from}</strong>: {sideText(t.give)} ⇄ {sideText(t.want)}
                </span>
                <span className="answer">
                  <button
                    type="button"
                    className="primary"
                    onClick={run(async () => {
                      hud.set({ wallet: await town.acceptTrade(t.fromId, t.at) });
                      await refreshMe();
                    })}
                  >
                    Accept
                  </button>
                  <button type="button" onClick={run(() => town.declineTrade(t.fromId))}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {out && (
        <>
          <h3>Your offer</h3>
          <ul className="members">
            <li>
              <span>
                To <strong>{out.to}</strong>: {sideText(out.give)} ⇄ {sideText(out.want)}
              </span>
              <button type="button" className="link" onClick={run(() => town.withdrawTrade())}>
                Withdraw
              </button>
            </li>
          </ul>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
