import { minutesText, secondsUntil } from "@tokenmaxxing/core/format.ts";
import { GAMES, gameOf } from "@tokenmaxxing/core/games/index.ts";
import { MAX_STAKE, SPLITS, type Split } from "@tokenmaxxing/core/games/payouts.ts";
import type { GameId } from "@tokenmaxxing/core/games/types.ts";
import type { Lobby, MatchInfo, TableView } from "@tokenmaxxing/core/games/wire.ts";
import { namesIn } from "@tokenmaxxing/core/world.ts";
import { useEffect, useState } from "react";
import { arcade, openMatch } from "../net.ts";
import { hud, useHud } from "../store.ts";
import { Chat } from "./Chat.tsx";
import { MentionInput } from "./MentionInput.tsx";
import { Modal, useRun, useTicker } from "./ui.tsx";

const STAKES = [0, 10, 50, 100, 250];

const gameName = (id: GameId) => GAMES[id]?.name ?? id;
const optionsText = (t: { game: GameId; options: Record<string, string | number> }) =>
  t.game === "tokenmaxxing" ? ` · ${minutesText(Number(t.options.minutes))}` : "";

/** What the lobby means for me: games on, am I in one, my invites, and open tables I could sit at. */
function lobbySummary(lobby: Lobby, me: number | undefined) {
  const playing = lobby.matches.filter((m) => !m.outcome);
  return {
    playing,
    inGame: playing.some((m) => m.id === lobby.me.match),
    invites: lobby.tables.filter((t) => t.invited.some((i) => i.userId === me)),
    open: lobby.tables.filter((t) => t.open && !t.seated.some((p) => p.userId === me)),
  };
}

/** The 🎮 panel: your invites and table, open tables to join, and games to watch. */
export function ArcadePanel() {
  const lobby = useHud((s) => s.lobby);
  const me = useHud((s) => s.me?.userId);
  const { error, run } = useRun();
  if (!lobby)
    return (
      <Modal title="🎮 Arcade" beside={<Chat />}>
        Loading…
      </Modal>
    );
  const { invites, open: joinable, playing, inGame } = lobbySummary(lobby, me);
  const mine = lobby.tables.find((t) => t.id === lobby.me.table);
  const open = joinable.filter((t) => !invites.includes(t));

  return (
    <Modal title="🎮 Arcade" wide beside={<Chat />}>
      {invites.length > 0 && (
        <>
          <h3>Invited</h3>
          <ul className="tables">
            {invites.map((t) => (
              <TableRow key={t.id} table={t}>
                <button type="button" className="primary" onClick={run(() => arcade.answer(t.id, true))}>
                  Accept
                </button>
                <button type="button" onClick={run(() => arcade.answer(t.id, false))}>
                  Decline
                </button>
              </TableRow>
            ))}
          </ul>
        </>
      )}
      {mine && <YourTable table={mine} />}
      {inGame && (
        <button type="button" className="primary" onClick={() => openMatch(lobby.me.match!)}>
          ▶ Back to your game
        </button>
      )}
      <h3>Open tables</h3>
      {open.length === 0 ? (
        <p className="muted small">Nobody's waiting for players right now. Open a table!</p>
      ) : (
        <ul className="tables">
          {open.map((t) => (
            <TableRow key={t.id} table={t}>
              <button type="button" className="primary" onClick={run(() => arcade.join(t.id))}>
                Join · 🪙 {t.stake}
              </button>
            </TableRow>
          ))}
        </ul>
      )}
      {!mine && !inGame && (
        <button type="button" onClick={() => hud.set({ panel: { kind: "newTable" } })}>
          ＋ Open a table
        </button>
      )}
      {playing.length > 0 && (
        <>
          <h3>Being played</h3>
          <ul className="tables">
            {playing.map((m) => (
              <MatchRow key={m.id} match={m} />
            ))}
          </ul>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

const BOX_SHOWN = 3;

/** Under the leaderboard: open tables to join, how many games are on, and a way to start one. */
export function GamesBox() {
  const lobby = useHud((s) => s.lobby);
  const me = useHud((s) => s.me?.userId);
  const { error, run } = useRun();
  if (!lobby) return null;
  const { playing, inGame, open } = lobbySummary(lobby, me);
  const openArcade = () => hud.set({ panel: { kind: "arcade" } });
  return (
    <section className="panel games-box" aria-label="Games">
      <button type="button" className="miniboard-title" onClick={openArcade}>
        🎮 Games <span className="muted">· {playing.length} playing ›</span>
      </button>
      {open.length === 0 ? (
        <p className="muted small">No open tables right now.</p>
      ) : (
        <ul>
          {open.slice(0, BOX_SHOWN).map((t) => (
            <li key={t.id}>
              <span className="who">
                {gameOf(t.game)?.emoji} {gameName(t.game)}
              </span>
              <small className="muted">
                {t.seated.length}/{t.seats}
                {t.stake > 0 && ` · 🪙 ${t.stake}`}
              </small>
              {!inGame && lobby.me.table === null && (
                <button type="button" className="primary" onClick={run(() => arcade.join(t.id))}>
                  Join
                </button>
              )}
            </li>
          ))}
          {open.length > BOX_SHOWN && (
            <li>
              <button type="button" className="link muted small" onClick={openArcade}>
                +{open.length - BOX_SHOWN} more
              </button>
            </li>
          )}
        </ul>
      )}
      {inGame ? (
        <button type="button" className="primary wide" onClick={() => openMatch(lobby.me.match!)}>
          ▶ Back to your game
        </button>
      ) : lobby.me.table !== null ? (
        <button type="button" className="wide" onClick={openArcade}>
          Your table is waiting…
        </button>
      ) : (
        <button type="button" className="wide" onClick={() => hud.set({ panel: { kind: "newTable" } })}>
          ＋ New game
        </button>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  );
}

function TableRow({ table, children }: { table: TableView; children: React.ReactNode }) {
  const host = table.seated.find((s) => s.userId === table.host)?.name ?? "someone";
  return (
    <li>
      <span>
        <strong>
          {gameOf(table.game)?.emoji} {gameName(table.game)}
        </strong>
        {optionsText(table)}
        <br />
        <small className="muted">
          {host}'s table · {table.seated.length}/{table.seats} seated · 🪙 {table.stake} to play · pot 🪙{" "}
          {table.stake * table.seated.length}
          {table.seats > 2 && ` · ${SPLITS[table.split]}`}
        </small>
      </span>
      <span className="row-actions">{children}</span>
    </li>
  );
}

function MatchRow({ match }: { match: MatchInfo }) {
  return (
    <li>
      <span>
        <strong>
          {gameOf(match.game)?.emoji} {gameName(match.game)}
        </strong>
        <br />
        <small className="muted">
          {match.players.map((p) => p.name).join(" vs ")} · pot 🪙 {match.pot}
        </small>
      </span>
      <button type="button" onClick={() => openMatch(match.id)}>
        👀 Watch
      </button>
    </li>
  );
}

/** Your table while it waits: who's in, who's invited, and the host's buttons. */
function YourTable({ table }: { table: TableView }) {
  const me = useHud((s) => s.me?.userId);
  const { error, run } = useRun();
  const [name, setName] = useState("");
  const host = table.host === me;
  const min = GAMES[table.game]!.players.min;
  const free = table.seats - table.seated.length - table.invited.length;
  return (
    <section className="your-table">
      <h3>
        Your table: {gameOf(table.game)?.emoji} {gameName(table.game)}
        {optionsText(table)} · 🪙 {table.stake}
      </h3>
      <ul className="seats">
        {table.seated.map((s) => (
          <li key={s.userId}>✓ {s.name}</li>
        ))}
        {table.invited.map((i) => (
          <li key={i.userId} className="muted">
            ⏳ {i.name}
            {i.counter !== null && (
              <>
                {" "}
                wants 🪙 {i.counter}
                {host && (
                  <button
                    type="button"
                    className="link"
                    onClick={run(() => arcade.takeCounter(table.id, i.userId))}
                  >
                    Take it
                  </button>
                )}
              </>
            )}
          </li>
        ))}
        {Array.from({ length: Math.max(0, free) }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: empty seats have nothing else to key on
          <li key={`free${i}`} className="muted">
            ○ {table.open ? "free seat" : "invite someone"}
          </li>
        ))}
      </ul>
      {host && free > 0 && (
        <form
          className="inline-form"
          onSubmit={run(() => arcade.invite(table.id, namesIn(name)).then(() => setName("")))}
        >
          <MentionInput label="Invite" value={name} onChange={setName} placeholder="Invite @name" />
          <button type="submit">Invite</button>
        </form>
      )}
      <div className="row-actions">
        {host && (
          <button
            type="button"
            className="primary"
            disabled={table.seated.length < min}
            onClick={run(() => arcade.start(table.id))}
          >
            ▶ Start ({table.seated.length}/{table.seats})
          </button>
        )}
        <button type="button" className="danger" onClick={run(() => arcade.leave(table.id))}>
          {host ? "Close table" : "Leave"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** Opening a table: the game, seats, stake, split, open or invite only, and who to invite. */
export function NewTable({ invite, inviteName }: { invite?: number; inviteName?: string }) {
  const wallet = useHud((s) => s.wallet);
  const [game, setGame] = useState<GameId>("spr");
  const def = GAMES[game]!;
  const [seats, setSeats] = useState(def.players.max);
  const [wanted, setStake] = useState(10);
  const [split, setSplit] = useState<Split>("all");
  const [open, setOpen] = useState(invite === undefined);
  const [names, setNames] = useState("");
  const [minutes, setMinutes] = useState(60);
  const { error, run } = useRun();
  useEffect(() => {
    setSeats(invite !== undefined ? def.players.min : def.players.max);
  }, [def, invite]);
  const cap = Math.min(MAX_STAKE, Math.floor((wallet?.balance ?? 0) / 2));
  const stake = Math.min(wanted, cap);

  const submit = run(async () => {
    const people = [...(invite !== undefined ? [invite] : []), ...namesIn(names)];
    await arcade.open(game, {
      stake,
      seats,
      split,
      open,
      invite: people,
      options: game === "tokenmaxxing" ? { minutes } : {},
    });
    hud.set({ panel: { kind: "arcade" } });
  });

  return (
    <Modal
      title={inviteName ? `🎮 Invite ${inviteName} to a game` : "🎮 Open a table"}
      wide
      beside={<Chat />}
    >
      <ul className="game-picker">
        {Object.values(GAMES).map((g) => (
          <li key={g.id}>
            <button
              type="button"
              className="choice card"
              aria-pressed={g.id === game}
              onClick={() => setGame(g.id)}
            >
              <span className="game-emoji">{g.emoji}</span>
              <strong>{g.name}</strong>
              <small className="muted">
                {g.blurb}{" "}
                {g.players.min === g.players.max
                  ? `${g.players.min} players`
                  : `${g.players.min}–${g.players.max} players`}
              </small>
            </button>
          </li>
        ))}
      </ul>
      <form className="table-form" onSubmit={submit}>
        {game === "tokenmaxxing" && (
          <label>
            How long
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {(def.options?.minutes ?? []).map((m) => (
                <option key={m} value={m}>
                  {minutesText(Number(m))}
                </option>
              ))}
            </select>
          </label>
        )}
        {def.players.max > 2 && (
          <label>
            Seats
            <input
              type="number"
              min={def.players.min}
              max={def.players.max}
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
            />
          </label>
        )}
        {/* A fieldset, not a label: clicking a label's text would press its first button (Free). */}
        <fieldset>
          <legend>Stake (up to 🪙 {cap})</legend>
          <span className="stakes">
            {STAKES.filter((s) => s <= cap).map((s) => (
              <button
                key={s}
                type="button"
                className="choice"
                aria-pressed={s === stake}
                onClick={() => setStake(s)}
              >
                {s === 0 ? "Free" : `🪙 ${s}`}
              </button>
            ))}
            <input
              type="number"
              aria-label="Stake"
              min={0}
              max={cap}
              value={stake}
              onChange={(e) => setStake(Math.max(0, Math.min(cap, Number(e.target.value))))}
            />
          </span>
        </fieldset>
        {seats > 2 && (
          <label>
            The pot goes to
            <select value={split} onChange={(e) => setSplit(e.target.value as Split)}>
              {Object.entries(SPLITS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          Open to everyone (anyone can take a free seat)
        </label>
        {/* Not a label: the @-suggestions are buttons, and a label would press the first one. */}
        <div className="field">
          {inviteName ? "Invite others too" : "Invite"}
          <MentionInput
            label={inviteName ? "Invite others too" : "Invite"}
            value={names}
            onChange={setNames}
            placeholder="@ada @bo"
          />
        </div>
        <button type="submit" className="primary">
          {inviteName ? `Challenge ${inviteName}` : "Open the table"} · 🪙 {stake}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

/** "ada invites you to …" with Accept, Decline, or a counter offer. */
export function InviteToast() {
  const invite = useHud((s) => s.inviteTable);
  const lobby = useHud((s) => s.lobby);
  const me = useHud((s) => s.me?.userId);
  const [counter, setCounter] = useState<number | null>(null);
  const { error, run } = useRun();
  useTicker(1000, invite !== null);
  const table = lobby?.tables.find((t) => t.id === invite);
  const mine = table?.invited.find((i) => i.userId === me);
  if (invite === null || !table || !mine) return null;
  const host = table.seated.find((s) => s.userId === table.host)?.name ?? "Someone";
  const left = secondsUntil(mine.expiresAt, Date.now());
  const done = (fn: () => Promise<unknown>) =>
    run(async () => {
      await fn();
      hud.set({ inviteTable: null });
    });
  return (
    <div className="toast invite-toast" role="alert">
      <p>
        🎮 <strong>{host}</strong> invites you to {gameName(table.game)}
        {optionsText(table)} · {table.seated.length}/{table.seats} seated · 🪙 {table.stake}
        <span className="muted"> · {left}s</span>
      </p>
      <div className="row-actions">
        <button type="button" className="primary" onClick={done(() => arcade.answer(table.id, true))}>
          Accept
        </button>
        <button type="button" onClick={done(() => arcade.answer(table.id, false))}>
          Decline
        </button>
        {counter === null ? (
          <button type="button" className="link" onClick={() => setCounter(Math.floor(table.stake / 2))}>
            Counter…
          </button>
        ) : (
          <span className="counter">
            🪙
            <input
              type="number"
              aria-label="Your stake"
              min={0}
              max={MAX_STAKE}
              value={counter}
              onChange={(e) => setCounter(Number(e.target.value))}
            />
            <button type="button" onClick={done(() => arcade.answer(table.id, { counter }))}>
              Offer
            </button>
          </span>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
