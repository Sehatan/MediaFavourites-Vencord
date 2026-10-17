/*
 * MediaFavourites, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type MediaKind = "image" | "video";

export interface Media {
    kind: MediaKind;
    url: string;
    width: number;
    height: number;
    name: string;
    /** Discord already draws its own favourite star for GIFs, so ours would overlap it. */
    nativeStar: boolean;
}

/** Everything the hover star can read from a rendered `<img>` or `<video>`. */
export interface MediaDescriptor {
    /** Tag name of the rendered element, `img` or `video`. */
    tag: string;
    /** Rendered media URL, usually Discord's signed CDN link. */
    src?: string | null;
    /** Preferred URL, such as the full size link behind an image or `data-safe-src`. */
    safeSrc?: string | null;
    width?: number | null;
    height?: number | null;
    name?: string | null;
    mime?: string | null;
}

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;
const VIDEO_EXTENSION = /\.(mp4|webm)$/i;
const IMAGE_MIME = /^image\/(png|jpe?g|webp|avif|gif|bmp)(;|$)/i;
const VIDEO_MIME = /^video\/(mp4|webm)(;|$)/i;
const NATIVE_STAR_HOST = /(^|\.)(tenor|giphy)\.com$/i;
const DISCORD_CDN_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];
/** Parameters Discord's image proxy adds for thumbnails; dropping them restores the full size file. */
const PROXY_RESIZE_PARAMS = ["width", "height", "format", "quality"];
const MAX_DIMENSION = 16384;
const DEFAULT_SIZE: Record<MediaKind, { width: number; height: number; }> = {
    image: { width: 400, height: 300 },
    video: { width: 400, height: 225 }
};

function parseUrl(value: string): URL | undefined {
    try {
        return new URL(value);
    } catch {
        return;
    }
}

export function safeUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || !value) return;
    const url = parseUrl(value.startsWith("//") ? `https:${value}` : value);
    if (!url) return;
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    return url.href;
}

/**
 * Discord serves chat images through media.discordapp.net with resize parameters.
 * Saving that URL would send a downscaled picture, so point it back at the CDN and
 * drop the resize parameters. Discord's signature parameters are left untouched.
 */
export function normalizeMediaUrl(value: string): string {
    const url = parseUrl(safeUrl(value) ?? value);
    if (!url) return value;
    if (url.hostname === "media.discordapp.net" && url.pathname.startsWith("/attachments/")) {
        url.hostname = "cdn.discordapp.com";
        for (const parameter of PROXY_RESIZE_PARAMS) url.searchParams.delete(parameter);
    }
    return url.href;
}

/**
 * Only comparison keys lose Discord's transient signature; playable URLs never do.
 * This is also what lets the context menu and the hover star recognise the same media.
 */
export function mediaIdentity(value: string): string {
    const url = parseUrl(value);
    if (url && DISCORD_CDN_HOSTS.includes(url.hostname) && url.pathname.startsWith("/attachments/")) {
        return `discord:${url.pathname}`;
    }
    return url?.href ?? value;
}

export function mediaKind(url: string, mime = "", filename = ""): MediaKind | undefined {
    const path = parseUrl(url)?.pathname ?? url;
    const names = [path, filename];
    if (names.some(value => VIDEO_EXTENSION.test(value)) || VIDEO_MIME.test(mime)) return "video";
    if (names.some(value => IMAGE_EXTENSION.test(value)) || IMAGE_MIME.test(mime)) return "image";
    return;
}

/** GIFs inherit Discord's own favourite star, so the plugin must not draw a second one. */
export function hasNativeStar(url: string): boolean {
    const parsed = parseUrl(url);
    if (!parsed) return false;
    return NATIVE_STAR_HOST.test(parsed.hostname) || /\.gif$/i.test(parsed.pathname);
}

export function fileNameOf(url: string, provided?: string | null, fallback = "Media"): string {
    const given = provided?.trim();
    if (given) return given.slice(0, 80);
    const base = parseUrl(url)?.pathname.split("/").pop();
    if (!base) return fallback;
    try {
        return decodeURIComponent(base).slice(0, 80);
    } catch {
        return base.slice(0, 80);
    }
}

function dimension(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.min(MAX_DIMENSION, Math.round(value))
        : fallback;
}

/**
 * Turns a rendered media element into a favourite entry. URLs that are not media are
 * skipped (an image can sit inside a link to an article), and the tag decides the kind
 * when a CDN link carries no useful extension.
 */
export function mediaFromDescriptor(descriptor: MediaDescriptor): Media | undefined {
    const tag = descriptor.tag.toLowerCase();
    if (tag !== "img" && tag !== "video") return;

    const mime = descriptor.mime ?? "";
    const name = descriptor.name ?? "";
    const rendered = safeUrl(descriptor.src);
    const preferred = safeUrl(descriptor.safeSrc);
    const candidates = [preferred, rendered].filter((url): url is string => !!url).map(normalizeMediaUrl);

    let url: string | undefined;
    let kind: MediaKind | undefined;
    for (const candidate of candidates) {
        const detected = mediaKind(candidate, mime, name);
        if (!detected) continue;
        url = candidate;
        kind = detected;
        break;
    }

    // Nothing recognisable: fall back to what the element itself renders, never to an
    // unrelated "open in browser" link wrapped around the picture.
    url ??= rendered ? normalizeMediaUrl(rendered) : candidates[0];
    if (!url) return;
    kind ??= tag === "video" ? "video" : "image";

    const fallback = DEFAULT_SIZE[kind];
    return {
        url,
        kind,
        width: dimension(descriptor.width, fallback.width),
        height: dimension(descriptor.height, fallback.height),
        name: fileNameOf(url, descriptor.name),
        nativeStar: hasNativeStar(url)
    };
}

export interface MediaRect {
    right: number;
    top: number;
}

export interface HostRect {
    left: number;
    top: number;
    clientLeft: number;
    clientTop: number;
    clientWidth: number;
    clientHeight: number;
}

/**
 * Top-right corner of the media, expressed in the containing block's absolute
 * coordinates and kept inside the host so a star is never clipped away.
 */
export function starOffset(media: MediaRect, host: HostRect, size: number, inset: number): { left: number; top: number; } {
    const left = media.right - (host.left + host.clientLeft) - size - inset;
    const top = media.top - (host.top + host.clientTop) + inset;
    return {
        left: Math.round(Math.max(2, Math.min(host.clientWidth - size - 2, left))),
        top: Math.round(Math.max(2, Math.min(host.clientHeight - size - 2, top)))
    };
}

export function collectMedia(props: any): Media[] {
    const found = new Map<string, Media>();
    const add = (value: unknown, info: any = {}) => {
        const url = safeUrl(value);
        if (!url) return;
        const kind = mediaKind(url, info.content_type ?? info.contentType ?? "", info.filename ?? "");
        if (!kind) return;
        const normalized = normalizeMediaUrl(url);
        const id = mediaIdentity(normalized);
        if (found.has(id)) return;
        const fallback = DEFAULT_SIZE[kind];
        found.set(id, {
            url: normalized,
            kind,
            width: dimension(info.width, fallback.width),
            height: dimension(info.height, fallback.height),
            name: fileNameOf(normalized, info.filename),
            nativeStar: hasNativeStar(normalized)
        });
    };

    for (const attachment of props?.message?.attachments ?? []) add(attachment.url, attachment);
    for (const embed of props?.message?.embeds ?? []) {
        if (embed.video) add(embed.video.url, embed.video);
        else if (embed.image) add(embed.image.url, { ...embed.image, content_type: "image/png" });
    }
    for (const url of props?.message?.content?.match(/https?:\/\/[^\s<>]+/g) ?? []) add(url);

    const clickedUrls = [props?.itemSrc, props?.src, props?.itemHref, props?.href]
        .map(safeUrl)
        .filter((url): url is string => !!url);
    for (const clicked of clickedUrls) {
        const existing = found.get(mediaIdentity(clicked));
        if (existing) return [existing];
        add(clicked);
        const selected = found.get(mediaIdentity(clicked));
        if (selected) return [selected];
    }
    // A click on an unrelated link must not select another attachment.
    if (clickedUrls.length && props?.itemHref) return [];
    return [...found.values()];
}
