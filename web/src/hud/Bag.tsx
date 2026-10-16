import { itemById } from "@tokenmaxxing/core/shop.ts";
import type { BagRow } from "@tokenmaxxing/server/registry";
import { useEffect, useState } from "react";
import { world } from "../game/world.ts";
import { refreshMe, town } from "../net.ts";
import { hud, useHud } from "../store.ts";
import { ItemImage, WearButton } from "./Shop.tsx";
import { Modal, useRun } from "./ui.tsx";

/**
 * What I hold, one card per kind: how many, Wear, and Drop (onto the floor where I am: in my own
 * office, that's furnishing it). 🏅 is a level reward: it stays with me.
 */
export function Bag() {
  const me = useHud((s) => s.me);
  const inMyOffice = useHud((s) => s.room === `office:${world.selfId}`);
  const [bag, setBag] = useState<BagRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { error, run } = useRun();
  useEffect(() => {
    void town.bag().then(setBag);
  }, []);
  if (!me || !bag) return <Modal title="🎒 Bag">Loading…</Modal>;

  const drop = (item: string) =>
    run(async () => {
      setNotice(null); // a refused one shows only its error
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
              <WearButton item={item} look={me.look} run={run} />
              {item.tradeable && (
                <button type="button" onClick={drop(item.id)}>
                  {inMyOffice ? "Drop here" : "Drop"}
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
