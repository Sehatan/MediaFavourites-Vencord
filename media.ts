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
    /** Discord already draws its own favourite star for GIFs, so the accessory leaves them alone. */
    nativeStar: boolean;
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

/** GIFs inherit Discord's own favourite star, so the accessory must not add another button. */
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

export function collectMedia(props: any): Media[] {
    const found = new Map<string, Media>();
    const add = (value: unknown, info: any = {}) => {
        if (info?.spoiler) return;

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
