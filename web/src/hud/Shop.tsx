import { MAPS } from "@tokenmaxxing/core/maps.ts";
import { FURNITURE, withPieces } from "@tokenmaxxing/core/office.ts";
import { ITEMS, type Item, PODIUM_COINS } from "@tokenmaxxing/core/shop.ts";
import type { Look } from "@tokenmaxxing/core/world.ts";
import type { BagRow } from "@tokenmaxxing/server/registry";
import { useEffect, useRef, useState } from "react";
import { itemFrame } from "../art/characters.ts";
import { objectAt } from "../art/objects.ts";
import { C } from "../art/palette.ts";
import { petFrame } from "../art/pets.ts";
import { refreshMe, town } from "../net.ts";
import { hud, useHud } from "../store.ts";
import { AvatarImage, Modal, Pills, useRun } from "./ui.tsx";

const TABS = [
  ["outfit", "Clothes"],
  ["glasses", "Glasses"],
  ["hat", "Hats"],
  ["pet", "Pets"],
  ["furniture", "Furniture"],
] as const;

const PLACES = ["🥇", "🥈", "🥉"];

export function Shop() {
  const me = useHud((s) => s.me);
  const wallet = useHud((s) => s.wallet);
  const [tab, setTab] = useState<Item["slot"]>("outfit");
  const [bag, setBag] = useState<BagRow[]>([]);
  const { error, run } = useRun();
  useEffect(() => {
    void town.wallet().then((w) => hud.set({ wallet: w }));
    void town.bag().then(setBag);
  }, []);
  if (!me || !wallet) return <Modal title="🪙 Shop">Loading…</Modal>;

  // The first one bought goes on; another is for trading.
  const buy = (item: Item) =>
    run(async () => {
      hud.set({ wallet: await town.buy(item.id) });
      setBag(await town.bag());
      if (item.slot !== "furniture" && !wallet.owned.includes(item.id))
        await wear({ ...me.look, [item.slot]: item.index });
    });

  return (
    <Modal title="🪙 Shop" wide>
      <p className="wallet">
        <strong>🪙 {wallet.balance.toLocaleString()}</strong> coins
        <span className="muted"> · +{wallet.today} from today so far</span>
      </p>
      <p className="muted small">
        Every day you earn √(tokens ÷ 1M) coins: 100M tokens is 10, 1B is 31. Finish a day 1st, 2nd or 3rd for{" "}
        {PODIUM_COINS.join(", ")} more.
        {wallet.wins.length > 0 &&
          ` Lately: ${wallet.wins
            .slice(0, 5)
            .map((w) => `${PLACES[w.place - 1]} ${w.day.slice(5)}`)
            .join(" ")}`}
      </p>
      <h3>📜 Today's quests</h3>
      <ul className="members">
        {wallet.quests.map((q) => (
          <li key={q.id} className={q.done ? undefined : "muted"}>
            <span>
              {q.done ? "✓" : "○"} {q.text}
            </span>
            <span>🪙 {q.coins}</span>
          </li>
        ))}
      </ul>
      <Pills value={tab} options={TABS} onChange={setTab} />
      <ul className="shop">
        {ITEMS.filter((i) => i.slot === tab).map((item) => {
          const owned = wallet.owned.includes(item.id);
          const wearing = item.slot !== "furniture" && me.look[item.slot] === item.index;
          const n = bag.find((b) => b.item === item.id)?.count ?? 0;
          return (
            <li key={item.id} className={wearing ? "wearing" : undefined}>
              <ItemImage item={item} look={me.look} />
              <span>
                {item.name}
                {n > 0 && <span className="muted"> ×{n}</span>}
              </span>
              {(owned || wearing) && <WearButton item={item} look={me.look} run={run} />}
              {item.level !== undefined ? (
                !owned && (
                  <button type="button" disabled>
                    🔒 Lv {item.level}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={wallet.balance < item.price}
                  onClick={buy(item)}
                >
                  🪙 {item.price}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

const wear = async (look: Look) => {
  await town.setLook(look);
  await refreshMe();
};

/** Wear it, or take it off; nothing for furniture. */
export function WearButton({
  item,
  look,
  run,
}: {
  item: Item;
  look: Look;
  run: ReturnType<typeof useRun>["run"];
}) {
  const slot = item.slot;
  if (slot === "furniture") return null;
  const on = look[slot] === item.index;
  return (
    <button type="button" onClick={run(() => wear({ ...look, [slot]: on ? 0 : item.index }))}>
      {on ? "Take off" : "Wear"}
    </button>
  );
}

/** An item as it looks: on me (or `bare`, on its own), the pet, or the piece. */
export function ItemImage({ item, look, bare }: { item: Item; look: Look; bare?: boolean }) {
  if (item.slot === "pet") return <SpriteImage sprite={petFrame(item.index, false, false)} stand />;
  if (item.slot === "furniture") return <PieceImage ch={FURNITURE[item.index]!.ch} />;
  if (bare) return <SpriteImage sprite={itemFrame(item)} />;
  return <AvatarImage look={{ ...look, [item.slot]: item.index }} scale={4} />;
}

/** A piece as the world draws it, in a two-tile box. A rug is only floor, so it's a swatch. */
function PieceImage({ ch, scale = 2 }: { ch: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g) return;
    g.imageSmoothingEnabled = false;
    const sprite = objectAt(withPieces([{ ch, x: 1, y: 1 }], MAPS.office), 1, 1)?.canvas;
    if (!sprite) {
      g.fillStyle = C.rug;
      g.fillRect(8 * scale, 16 * scale, 16 * scale, 14 * scale);
      return;
    }
    const { width: w, height: h } = sprite;
    g.drawImage(sprite, ((32 - w) / 2) * scale, (32 - h) * scale, w * scale, h * scale);
  }, [ch, scale]);
  return <canvas ref={ref} width={32 * scale} height={32 * scale} className="avatar" />;
}

/** A sprite at 4× in a 16×16 box: in the middle, or standing on the bottom (a pet). */
function SpriteImage({ sprite, stand }: { sprite: HTMLCanvasElement | null; stand?: boolean }) {
  const scale = 4;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g || !sprite) return;
    g.imageSmoothingEnabled = false;
    const { width: w, height: h } = sprite;
    g.drawImage(
      sprite,
      ((16 - w) / 2) * scale,
      (stand ? 16 - h : (16 - h) / 2) * scale,
      w * scale,
      h * scale,
    );
  }, [sprite, stand]);
  return <canvas ref={ref} width={16 * scale} height={16 * scale} className="avatar" />;
}
