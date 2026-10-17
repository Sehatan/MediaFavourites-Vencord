/*
 * MediaFavourites, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { StarFilled, StarOutlined } from "@components/Icons";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { Menu, showToast, useEffect, useState } from "@webpack/common";
import { UserSettingsActionCreators } from "@webpack/common/userSettings";

import "./styles.css";
import { collectMedia, Media, mediaIdentity } from "./media";

const logger = new Logger("MediaFavourites");
const cl = classNameFactory("vc-mediafavourites-");

// Native actions preserve Discord's size limit, persistence and picker notifications.
const addFavorite = findByCodeLazy("GIF_FAVORITED", '"favoriteGifs"');
const removeFavorite = findByCodeLazy("GIF_UNFAVORITED", '"favoriteGifs"');
const GifFormat = findByPropsLazy("NONE", "IMAGE", "VIDEO");

interface Favorite {
    src: string;
    format: number;
}

function favourites(): Record<string, Favorite> {
    return UserSettingsActionCreators.FrecencyUserSettingsActionCreators.getCurrentValue()?.favoriteGifs?.gifs ?? {};
}

function matchingKey(media: Media): string | undefined {
    const identity = mediaIdentity(media.url);

    return Object.entries(favourites()).find(([key, value]) =>
        mediaIdentity(key) === identity || mediaIdentity(value.src) === identity
    )?.[0];
}

const favouriteListeners = new Set<() => void>();

function notifyFavourites() {
    favouriteListeners.forEach(listener => listener());
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
        notifyFavourites();
    }
}

const patchMenu: NavContextMenuPatchCallback = (children, props) => {
    const media = collectMedia(props);
    if (!media.length) return;

    const item = (entry: Media, index: number, includeName: boolean) => {
        const saved = !!matchingKey(entry);

        return (
            <Menu.MenuItem
                key={`media-favourites-${index}`}
                id={`media-favourites-${index}`}
                label={`${saved ? `Remove ${entry.kind} from` : `Add ${entry.kind} to`} favourites${includeName ? `: ${entry.name}` : ""}`}
                action={() => { void changeFavorite(entry, saved); }}
            />
        );
    };

    children.push(
        <Menu.MenuGroup key="media-favourites-group">
            {media.length === 1
                ? item(media[0], 0, false)
                : (
                    <Menu.MenuItem id="media-favourites-submenu" label="Image & video favourites">
                        {media.map((entry, index) => item(entry, index, true))}
                    </Menu.MenuItem>
                )}
        </Menu.MenuGroup>
    );
};

const settings = definePluginSettings({
    starButton: {
        type: OptionType.BOOLEAN,
        description: "Show favourite star buttons under messages that contain images or videos",
        default: true
    }
});

function useIsFavourite(media: Media) {
    const [saved, setSaved] = useState(() => !!matchingKey(media));

    useEffect(() => {
        const update = () => setSaved(!!matchingKey(media));

        update();
        favouriteListeners.add(update);

        return () => {
            favouriteListeners.delete(update);
        };
    }, [media.url]);

    return saved;
}

function FavouriteButton({ media }: { media: Media; }) {
    const saved = useIsFavourite(media);
    const [busy, setBusy] = useState(false);

    const label = `${saved ? "Remove" : "Add"} ${media.kind} ${saved ? "from" : "to"} favourites${media.name ? `: ${media.name}` : ""}`;

    return (
        <Button
            variant="none"
            size="iconOnly"
            className={cl("button", saved && "saved")}
            title={label}
            aria-label={label}
            aria-pressed={saved}
            disabled={busy}
            onClick={async () => {
                setBusy(true);
                try {
                    await changeFavorite(media, saved);
                } finally {
                    setBusy(false);
                }
            }}
        >
            {saved
                ? <StarFilled className={cl("star")} />
                : <StarOutlined className={cl("star")} />}
        </Button>
    );
}

function MediaFavouriteAccessory({ message }: { message: Message; }) {
    const { starButton } = settings.use(["starButton"]);

    if (!starButton) return null;

    const media = collectMedia({ message }).filter(entry =>
        !entry.nativeStar && entry.width >= 64 && entry.height >= 40
    );
    if (!media.length) return null;

    return (
        <div className={cl("row")} role="group" aria-label="Media favourites">
            {media.map(entry => <FavouriteButton key={entry.url} media={entry} />)}
        </div>
    );
}

export default definePlugin({
    name: "MediaFavourites",
    description: "Add images and videos to your GIF favourites from a star button under the message or the context menu. Made with DeepSeek Harness.",
    tags: ["Media", "Utility"],
    searchTerms: ["favourites", "favorites", "gif favourites", "star", "media"],
    authors: [{ name: "Sehatan", id: 538413488146481166n }],
    settings,
    renderMessageAccessory: props => <MediaFavouriteAccessory message={props.message} />,
    contextMenus: {
        "message": patchMenu,
        "image-context": patchMenu
    }
});
