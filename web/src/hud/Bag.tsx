import { itemById } from "@tokenmaxxing/core/shop.ts";
import type { BagRow } from "@tokenmaxxing/server/registry";
import { useEffect, useState } from "react";
import { refreshMe, town } from "../net.ts";
import { hud, useHud } from "../store.ts";
import { ItemImage, WearButton } from "./Shop.tsx";
import { Modal, useRun } from "./ui.tsx";

/**
 * What I hold, one card per kind: how many, how many are in my office, Wear, and Drop (onto the floor
 * where I am). 🏅 is a level reward: it stays with me.
 */
export function Bag() {
  const me = useHud((s) => s.me);
  const [bag, setBag] = useState<BagRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { error, run } = useRun();
  useEffect(() => {
    void town.bag().then(setBag);
  }, []);
  if (!me || !bag) return <Modal title="🎒 Bag">Loading…</Modal>;

  const drop = (item: string) =>
    run(async () => {
      setNotice((await town.drop(item)).notice);
      setBag(await town.bag());
      await refreshMe(); // a worn one comes off
    });

  return (
    <Modal title="🎒 Bag" wide>
      {bag.length === 0 && (
        <p className="muted">
          Nothing yet.{" "}
          <button type="button" className="link" onClick={() => hud.set({ panel: { kind: "shop" } })}>
            🪙 Shop
          </button>
        </p>
      )}
      <ul className="shop">
        {bag.map((b) => {
          const item = itemById(b.item);
          if (!item) return null;
          const wearing = item.slot !== "furniture" && me.look[item.slot] === item.index;
          return (
            <li key={b.item} className={wearing ? "wearing" : undefined}>
              <ItemImage item={item} look={me.look} />
              <span>
                {!item.tradeable && "🏅 "}
                {item.name}
                <span className="muted"> ×{b.count}</span>
              </span>
              {b.placed > 0 && <small className="muted">{b.placed} placed</small>}
              <WearButton item={item} look={me.look} run={run} />
              {item.tradeable && b.count > b.placed && (
                <button type="button" onClick={drop(item.id)}>
                  Drop
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {notice && <p className="muted">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
