/*
 * MediaFavourites, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { Menu, showToast } from "@webpack/common";
import { UserSettingsActionCreators } from "@webpack/common/userSettings";

import { collectMedia, Media, mediaFromDescriptor, mediaIdentity, safeUrl, starOffset } from "./media";

const logger = new Logger("MediaFavourites");
// Native actions preserve Discord's size limit, persistence and picker notifications.
const addFavorite = findByCodeLazy("GIF_FAVORITED", '"favoriteGifs"');
const removeFavorite = findByCodeLazy("GIF_UNFAVORITED", '"favoriteGifs"');
const GifFormat = findByPropsLazy("NONE", "IMAGE", "VIDEO");

interface Favorite { src: string; format: number; }

function favourites(): Record<string, Favorite> {
    return UserSettingsActionCreators.FrecencyUserSettingsActionCreators.getCurrentValue()?.favoriteGifs?.gifs ?? {};
}

/** Every identity Discord stores a favourite under, so lookups stay one Set check. */
function savedIdentities(): Set<string> {
    const identities = new Set<string>();
    for (const [key, value] of Object.entries(favourites())) {
        identities.add(mediaIdentity(key));
        if (value?.src) identities.add(mediaIdentity(value.src));
    }
    return identities;
}

function matchingKey(media: Media): string | undefined {
    const identity = mediaIdentity(media.url);
    return Object.entries(favourites()).find(([key, value]) =>
        mediaIdentity(key) === identity || mediaIdentity(value.src) === identity
    )?.[0];
}

const pending = new Set<string>();
async function changeFavorite(media: Media, remove: boolean) {
    const id = mediaIdentity(media.url);
    if (pending.has(id)) return;
    pending.add(id);
    try {
        const key = matchingKey(media);
        if (remove) {
            if (!key) return;
            removeFavorite(key);
        } else {
            if (key) {
                showToast({ text: "This media is already in your favourites.", variant: "default" });
                return;
            }
            const format = media.kind === "image" ? GifFormat.IMAGE : GifFormat.VIDEO;
            if (typeof format !== "number") throw new Error("GIF format module unavailable");
            addFavorite({ url: media.url, src: media.url, width: media.width, height: media.height, format });
        }
        // The native action returns void. Check its local store instead of reporting
        // success unconditionally (for example when Discord rejects a full list).
        let changed = false;
        for (let attempt = 0; attempt < 20; attempt++) {
            changed = remove ? !matchingKey(media) : !!matchingKey(media);
            if (changed) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        showToast({
            text: changed
                ? remove ? "Removed from favourites." : "Added to favourites — open GIFs → Favourites."
                : "Discord did not update favourites. The list may be full; try again after reopening the picker.",
            variant: changed ? "success" : "critical"
        });
    } catch (error) {
        logger.error("Unable to update media favourite", error);
        showToast({ text: "Could not update favourites. Update Vencord or check the console for details.", variant: "critical" });
    } finally {
        pending.delete(id);
        refreshStars();
    }
}

const patchMenu: NavContextMenuPatchCallback = (children, props) => {
    const media = collectMedia(props);
    if (!media.length) return;
    try {
        const item = (entry: Media, index: number, includeName: boolean) => {
            const saved = !!matchingKey(entry);
            return <Menu.MenuItem
                key={`media-favourites-${index}`}
                id={`media-favourites-${index}`}
                label={`${saved ? `Remove ${entry.kind} from` : `Add ${entry.kind} to`} favourites${includeName ? `: ${entry.name}` : ""}`}
                action={() => { void changeFavorite(entry, saved); }}
            />;
        };
        children.push(<Menu.MenuGroup key="media-favourites-group">
            {media.length === 1 ? item(media[0], 0, false) :
                <Menu.MenuItem id="media-favourites-submenu" label="Image & video favourites">
                    {media.map((entry, index) => item(entry, index, true))}
                </Menu.MenuItem>}
        </Menu.MenuGroup>);
    } catch (error) {
        logger.error("Favourites module unavailable", error);
    }
};

/* ---------------------------------------------------------------------------------- *
 * Hover star
 *
 * Discord puts an invisible, absolutely positioned <a data-role="img"> over every
 * image, and preview videos often have no box until they start playing. Reacting to
 * the hovered element is therefore unreliable: the star is chosen from the pointer
 * position against the media boxes instead, and drawn inside the message item rather
 * than inside Discord's media wrapper so nothing can cover or clip it.
 * ---------------------------------------------------------------------------------- */

const STAR_CLASS = "mfavourites-star";
const STYLE_ID = "mfavourites-style";
const ALWAYS_SHOW_ATTRIBUTE = "data-mfavourites-always-show";
const STAR_SIZE = 26;
const STAR_INSET = 6;
const MIN_WIDTH = 64;
const MIN_HEIGHT = 40;
const MESSAGE_ITEM_SELECTOR = '[id^="chat-messages-"],[data-list-item-id^="chat-messages"]';
const MEDIA_IN_MESSAGES = [
    '[id^="chat-messages-"] img',
    '[id^="chat-messages-"] video',
    '[data-list-item-id^="chat-messages"] img',
    '[data-list-item-id^="chat-messages"] video'
].join(",");
const MEDIA_ELEMENTS = "img, video";
/** Discord wraps every image in this container, with the original URL link beside it. */
const IMAGE_WRAPPER = '[class*="imageWrapper"]';
const ORIGINAL_LINK = 'a[data-role="img"]';
// Emoji, avatars, reactions and stickers keep their own UI; stickers and GIFs already
// carry Discord's favourite star, and spoilers must stay covered until opened.
const IGNORED_ANCESTOR = '[class*="emoji"],[class*="Emoji"],[class*="avatar"],[class*="Avatar"],'
    + '[class*="reaction"],[class*="Reaction"],[class*="sticker"],[class*="Sticker"],'
    + '[class*="spoiler"],[class*="Spoiler"]';

const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.4 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.7l6.1-.9z"/></svg>';

const STAR_STYLE = `
.${STAR_CLASS} {
    position: absolute;
    z-index: 5;
    box-sizing: border-box;
    width: ${STAR_SIZE}px;
    height: ${STAR_SIZE}px;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.62);
    color: #fff;
    line-height: 0;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transform: scale(0.9);
    transition: opacity 120ms ease, transform 120ms ease, background-color 120ms ease, color 120ms ease;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
}
.${STAR_CLASS}[data-visible="true"] { opacity: 1; pointer-events: auto; transform: scale(1); }
.${STAR_CLASS}:hover { background: rgba(0, 0, 0, 0.85); transform: scale(1.06); }
.${STAR_CLASS}:focus-visible { opacity: 1; pointer-events: auto; outline: 2px solid #5865f2; outline-offset: 2px; }
.${STAR_CLASS}[data-busy="true"] { cursor: progress; opacity: 0.7; }
.${STAR_CLASS} svg { width: 16px; height: 16px; display: block; }
.${STAR_CLASS} svg path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linejoin: round;
    stroke-linecap: round;
}
.${STAR_CLASS}[data-saved="true"] { color: #f0b232; }
.${STAR_CLASS}[data-saved="true"] svg path { fill: currentColor; }
html[${ALWAYS_SHOW_ATTRIBUTE}="1"] .${STAR_CLASS} { opacity: 1; pointer-events: auto; transform: scale(1); }
`;

let observer: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;
let scanTimer = 0;
let hoverFrame = 0;
let visibleStar: HTMLButtonElement | null = null;
let started = false;
let pointerX = 0;
let pointerY = 0;
const starOf = new WeakMap<HTMLElement, HTMLButtonElement>();
const stars = new Map<HTMLButtonElement, HTMLElement>();

const settings = definePluginSettings({
    starButton: {
        type: OptionType.BOOLEAN,
        description: "Show a favourite star when hovering images and videos in chat, like Discord's GIF star",
        default: true,
        onChange() {
            if (!started) return;
            if (settings.store.starButton) mountStar();
            else unmountStar();
        }
    },
    alwaysShowStar: {
        type: OptionType.BOOLEAN,
        description: "Always show the star instead of only on hover",
        default: false,
        onChange() {
            if (started && settings.store.starButton) applyAlwaysShow();
        }
    }
});

function messageItemOf(element: Element): HTMLElement | null {
    return element.closest<HTMLElement>(MESSAGE_ITEM_SELECTOR);
}

/** Message item as containing block: above Discord's media wrappers and their overlays. */
function overlayHost(element: HTMLElement): HTMLElement | null {
    const item = messageItemOf(element);
    if (!item) return null;
    if (getComputedStyle(item).position === "static") item.style.position = "relative";
    return item;
}

/**
 * Rendered media box. Videos fall back to their wrapper so a preview that has no video
 * frames yet still gets a star; images only count once they have a real box of their own.
 */
function mediaBox(element: HTMLElement): DOMRect | undefined {
    const own = element.getBoundingClientRect();
    if (own.width > 1 && own.height > 1) {
        return own.width >= MIN_WIDTH && own.height >= MIN_HEIGHT ? own : undefined;
    }
    if (element.tagName.toLowerCase() !== "video") return;
    const wrapper = element.parentElement?.getBoundingClientRect();
    if (wrapper && wrapper.width >= MIN_WIDTH && wrapper.height >= MIN_HEIGHT) return wrapper;
    return;
}

/** Reads the live DOM, so a changed `src` or a late image load is picked up on the next use. */
function describeMedia(element: HTMLElement): Media | undefined {
    const tag = element.tagName.toLowerCase();
    if (tag !== "img" && tag !== "video") return;

    const image = element as HTMLImageElement;
    const video = element as HTMLVideoElement;
    // The original (unresized) link lives in the overlay anchor, next to the picture.
    const wrapper = element.closest(IMAGE_WRAPPER);
    const original = wrapper?.querySelector<HTMLAnchorElement>(ORIGINAL_LINK);
    const anchor = element.closest("a[href]");
    const safeSrc = original?.getAttribute("href")
        ?? original?.getAttribute("data-safe-src")
        ?? element.getAttribute("data-safe-src")
        ?? (anchor ? anchor.getAttribute("href") : null);

    const rendered = tag === "img"
        ? image.currentSrc || element.getAttribute("src")
        : video.currentSrc || element.getAttribute("src") || element.querySelector("source")?.getAttribute("src");
    const box = mediaBox(element);
    const width = tag === "img" ? image.naturalWidth : video.videoWidth || video.clientWidth;
    const height = tag === "img" ? image.naturalHeight : video.videoHeight || video.clientHeight;

    return mediaFromDescriptor({
        tag,
        safeSrc,
        src: rendered,
        width: width || box?.width,
        height: height || box?.height,
        name: element.getAttribute("alt") || element.getAttribute("aria-label")
    });
}

function isEligible(element: HTMLElement): boolean {
    if (!messageItemOf(element)) return false;
    if (element.closest(IGNORED_ANCESTOR)) return false;
    if (!mediaBox(element)) return false;
    const media = describeMedia(element);
    return !!media && !media.nativeStar;
}

function placeStar(star: HTMLButtonElement, element: HTMLElement): void {
    const host = star.parentElement;
    if (!host || !star.isConnected || !element.isConnected) return;

    const box = mediaBox(element);
    if (!box) return;
    const hostBox = host.getBoundingClientRect();
    if (!hostBox.width || !hostBox.height) return;

    const { left, top } = starOffset(
        { right: box.right, top: box.top },
        {
            left: hostBox.left,
            top: hostBox.top,
            clientLeft: host.clientLeft,
            clientTop: host.clientTop,
            clientWidth: host.clientWidth,
            clientHeight: host.clientHeight
        },
        STAR_SIZE,
        STAR_INSET
    );

    star.style.left = `${left}px`;
    star.style.top = `${top}px`;
}

function disposeStar(star: HTMLButtonElement): void {
    const element = stars.get(star);
    if (element) {
        resizeObserver?.unobserve(element);
        if (starOf.get(element) === star) starOf.delete(element);
    }
    stars.delete(star);
    star.remove();
    if (visibleStar === star) visibleStar = null;
}

function refreshStar(star: HTMLButtonElement, identities = savedIdentities()): void {
    const element = stars.get(star);
    if (!element) return;

    const media = describeMedia(element);
    if (!media) {
        disposeStar(star);
        return;
    }

    const saved = identities.has(mediaIdentity(media.url));
    const label = saved ? "Remove from favourites" : "Add to favourites";
    star.dataset.saved = String(saved);
    star.title = label;
    star.setAttribute("aria-label", label);
    star.setAttribute("aria-pressed", String(saved));
}

function refreshStars(): void {
    const identities = savedIdentities();
    for (const star of [...stars.keys()]) {
        if (!star.isConnected) {
            disposeStar(star);
            continue;
        }
        refreshStar(star, identities);
    }
}

function hideVisibleStar(): void {
    if (!visibleStar) return;
    delete visibleStar.dataset.visible;
    visibleStar = null;
}

function showStar(star: HTMLButtonElement): void {
    const element = stars.get(star);
    if (!element) return;

    if (visibleStar === star) {
        placeStar(star, element);
        return;
    }

    hideVisibleStar();
    visibleStar = star;
    star.dataset.visible = "true";
    refreshStar(star);
    placeStar(star, element);
}

async function toggleFavourite(element: HTMLElement, star: HTMLButtonElement): Promise<void> {
    if (star.dataset.busy === "true") return;

    const media = describeMedia(element);
    if (!media) {
        showToast({ text: "This media link cannot be saved to favourites.", variant: "critical" });
        return;
    }

    star.dataset.busy = "true";
    try {
        await changeFavorite(media, savedIdentities().has(mediaIdentity(media.url)));
    } finally {
        star.dataset.busy = "false";
        refreshStars();
        placeStar(star, element);
    }
}

function ensureStar(element: HTMLElement): HTMLButtonElement | undefined {
    if (!started || !settings.store.starButton) return;

    const existing = starOf.get(element);
    if (existing?.isConnected) return existing;

    if (!isEligible(element)) return;

    const host = overlayHost(element);
    if (!host) return;

    const star = document.createElement("button");
    star.type = "button";
    star.className = STAR_CLASS;
    star.dataset.saved = "false";
    star.innerHTML = STAR_SVG;
    // Discord opens the image viewer on click and can react to mouse down as well.
    star.addEventListener("pointerdown", event => event.stopPropagation());
    star.addEventListener("mousedown", event => event.stopPropagation());
    star.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void toggleFavourite(element, star);
    });

    stars.set(star, element);
    starOf.set(element, star);
    refreshStar(star);
    host.appendChild(star);
    placeStar(star, element);
    resizeObserver?.observe(element);

    const reposition = () => {
        if (star.isConnected) placeStar(star, element);
    };
    element.addEventListener("load", reposition, { once: true });
    element.addEventListener("loadedmetadata", reposition, { once: true });

    return star;
}

/** Smallest media under the pointer; geometry works through Discord's invisible overlays. */
function mediaAt(item: HTMLElement, x: number, y: number): HTMLElement | undefined {
    let best: HTMLElement | undefined;
    let bestArea = Number.POSITIVE_INFINITY;

    for (const element of item.querySelectorAll<HTMLElement>(MEDIA_ELEMENTS)) {
        const box = mediaBox(element);
        if (!box) continue;
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
        if (!isEligible(element)) continue;

        const area = box.width * box.height;
        if (area < bestArea) {
            best = element;
            bestArea = area;
        }
    }

    return best;
}

function updateHover(): void {
    hoverFrame = 0;
    if (!started || !settings.store.starButton) return;

    const target = document.elementFromPoint(pointerX, pointerY);
    if (!(target instanceof Element)) {
        hideVisibleStar();
        return;
    }

    const star = target.closest<HTMLButtonElement>(`.${STAR_CLASS}`);
    if (star) {
        showStar(star);
        return;
    }

    const item = messageItemOf(target);
    if (!item) {
        hideVisibleStar();
        return;
    }

    const element = mediaAt(item, pointerX, pointerY);
    if (!element) {
        hideVisibleStar();
        return;
    }

    const found = ensureStar(element) ?? starOf.get(element);
    if (found?.isConnected) showStar(found);
    else hideVisibleStar();
}

function handlePointerMove(event: MouseEvent): void {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(updateHover);
}

/** Media can appear, resize or finish loading without Discord touching the DOM. */
function handleMediaEvent(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tag = target.tagName.toLowerCase();
    if (tag !== "img" && tag !== "video") return;
    if (!messageItemOf(target)) return;
    scheduleScan();
}

function scan(): void {
    if (!started || !settings.store.starButton) return;
    for (const element of document.querySelectorAll<HTMLElement>(MEDIA_IN_MESSAGES)) ensureStar(element);
    for (const star of [...stars.keys()]) {
        if (!star.isConnected) disposeStar(star);
    }
}

function scheduleScan(): void {
    if (scanTimer) return;
    // Disk-free but debounced: a scan reads every media box, and Discord mutates the
    // message list constantly. Hover creates stars on demand, so a delay is invisible.
    scanTimer = window.setTimeout(() => {
        scanTimer = 0;
        scan();
    }, 200);
}

function handleResize(): void {
    if (visibleStar) {
        const element = stars.get(visibleStar);
        if (element) placeStar(visibleStar, element);
    }
    scheduleScan();
}

function applyAlwaysShow(): void {
    if (settings.store.alwaysShowStar) document.documentElement.setAttribute(ALWAYS_SHOW_ATTRIBUTE, "1");
    else document.documentElement.removeAttribute(ALWAYS_SHOW_ATTRIBUTE);
}

function mountStar(): void {
    if (!started || !settings.store.starButton || document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STAR_STYLE;
    document.head.appendChild(style);

    document.addEventListener("mousemove", handlePointerMove, true);
    document.addEventListener("mouseleave", hideVisibleStar);
    document.addEventListener("load", handleMediaEvent, true);
    document.addEventListener("loadedmetadata", handleMediaEvent, true);
    window.addEventListener("blur", hideVisibleStar);
    window.addEventListener("resize", handleResize);

    resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
            const element = entry.target as HTMLElement;
            const star = starOf.get(element);
            if (star?.isConnected) placeStar(star, element);
        }
    });

    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });

    applyAlwaysShow();
    scan();
}

function unmountStar(): void {
    observer?.disconnect();
    observer = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = 0;
    }
    if (hoverFrame) {
        cancelAnimationFrame(hoverFrame);
        hoverFrame = 0;
    }
    document.removeEventListener("mousemove", handlePointerMove, true);
    document.removeEventListener("mouseleave", hideVisibleStar);
    document.removeEventListener("load", handleMediaEvent, true);
    document.removeEventListener("loadedmetadata", handleMediaEvent, true);
    window.removeEventListener("blur", hideVisibleStar);
    window.removeEventListener("resize", handleResize);
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.removeAttribute(ALWAYS_SHOW_ATTRIBUTE);
    for (const star of [...stars.keys()]) disposeStar(star);
    stars.clear();
    visibleStar = null;
}

function start(): void {
    started = true;
    mountStar();
}

function stop(): void {
    started = false;
    unmountStar();
}

export default definePlugin({
    name: "MediaFavourites",
    description: "Add images and videos to your GIF favourites with a hover star or the image context menu. Made with DeepSeek Harness.",
    tags: ["Media", "Utility"],
    searchTerms: ["favourites", "favorites", "gif favourites", "star", "media"],
    authors: [{ name: "Sehatan", id: 538413488146481166n }],
    settings,
    start,
    stop,
    contextMenus: {
        "message": patchMenu,
        "image-context": patchMenu
    }
});
