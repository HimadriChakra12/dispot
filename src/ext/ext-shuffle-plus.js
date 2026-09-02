// NAME: Shuffle+
// AUTHORS: khanhas, Tetrax-10 (original spicetify/cli extension)
// PORT: fixed for spicetify-web userscript embedding
// DESCRIPTION: True shuffle with no bias.
//
// Fixes applied vs upstream (spicetify/cli Extensions/shuffle+.js):
//   1. getConfig() now merges saved settings over defaults instead of
//      replacing them, so old/partial localStorage blobs no longer leave
//      CONFIG.artistMode/artistNameMust/enableQueueButton undefined.
//   2. fetchAndPlay()'s "clear context for folder/collection/local" check
//      compared `type` against the string literals "folder"/"collection"/
//      "local" — but Spicetify.URI.Type.FOLDER/COLLECTION/LOCAL_TRACK are
//      NOT those strings, so the check silently never matched and context
//      was always kept (causing a Spotify-side context/track mismatch
//      error on folders, collections and local files). Now compares
//      against the actual Type constants.
//   3. `case \`${Type.ARTIST}\`:` (template-literal case, always a no-op
//      coercion) replaced with a plain `case Type.ARTIST:`.
//   4. Hardcoded GraphQL persisted-query sha256 hashes for
//      queryArtistOverview/queryArtistDiscographyAll are pinned to a
//      specific desktop client build and are the most likely thing to
//      break silently on the web player (Spotify rotates persisted query
//      hashes per client build). This port prefers
//      Spicetify.GraphQL.Definitions.* when present and only falls back
//      to the hardcoded hashes, with a console warning, so a hash
//      mismatch fails loudly instead of throwing an opaque GraphQL error.
//   5. fetchArtistLikedTracks/fetchShows now guard on `res.item`/`res.items`
//      being present before mapping, since the CosmosAsync sp:// endpoints
//      can return an empty body instead of `{ item: [] }` on the web
//      player.
//   6. Wrapped registration (Menu item, ContextMenu items, Playbar button)
//      in a small init() so this file can be loaded as an ES module by
//      the bundlejs extension-patch loader instead of relying on being
//      eval'd as a bare IIFE.

(function registerShufflePlus(global) {
	const Spicetify = global.Spicetify;

	async function shufflePlus() {
		if (!(Spicetify && Spicetify.CosmosAsync && Spicetify.Platform)) {
			setTimeout(shufflePlus, 300);
			return;
		}

		const { React } = Spicetify;
		const { useState } = React;
		let playbarButton = null;

		const DEFAULT_CONFIG = {
			artistMode: "all",
			artistNameMust: false,
			enableQueueButton: false,
		};

		function getConfig() {
			let saved = {};
			try {
				const parsed = JSON.parse(Spicetify.LocalStorage.get("shufflePlus:settings"));
				if (parsed && typeof parsed === "object") saved = parsed;
			} catch {
				// ignore malformed/missing localStorage value, fall through to defaults
			}
			// Fix #1: merge over defaults instead of replacing, so a partial
			// or stale saved blob can't leave any CONFIG.* key undefined.
			const merged = { ...DEFAULT_CONFIG, ...saved };
			Spicetify.LocalStorage.set("shufflePlus:settings", JSON.stringify(merged));
			return merged;
		}

		const CONFIG = getConfig();

		function saveConfig() {
			Spicetify.LocalStorage.set("shufflePlus:settings", JSON.stringify(CONFIG));
		}

		function settingsPage() {
			const style = React.createElement(
				"style",
				null,
				`.popup-row::after { content: ""; display: table; clear: both; }
.popup-row .col { display: flex; padding: 10px 0; align-items: center; }
.popup-row .col.description { float: left; padding-right: 15px; }
.popup-row .col.action { float: right; text-align: right; }
.popup-row .div-title { color: var(--spice-text); }
.popup-row .divider { height: 2px; border-width: 0; background-color: var(--spice-button-disabled); }
button.checkbox { align-items: center; border: 0px; border-radius: 50%; background-color: rgba(var(--spice-rgb-shadow), 0.7); color: var(--spice-text); cursor: pointer; display: flex; margin-inline-start: 12px; padding: 8px; }
button.checkbox.disabled { color: rgba(var(--spice-rgb-text), 0.3); }
select { color: var(--spice-text); background: rgba(var(--spice-rgb-shadow), 0.7); border: 0; height: 32px; }
::-webkit-scrollbar { width: 8px; }`
			);

			function DisplayIcon({ icon, size }) {
				return React.createElement("svg", {
					width: size,
					height: size,
					viewBox: "0 0 16 16",
					fill: "currentColor",
					dangerouslySetInnerHTML: { __html: icon },
				});
			}

			function checkBoxItem({ name, field, onclickFun = () => {} }) {
				const [value, setValue] = useState(CONFIG[field]);
				return React.createElement(
					"div",
					{ className: "popup-row" },
					React.createElement("label", { className: "col description" }, name),
					React.createElement(
						"div",
						{ className: "col action" },
						React.createElement(
							"button",
							{
								className: `checkbox${value ? "" : " disabled"}`,
								onClick: () => {
									CONFIG[field] = !value;
									setValue(!value);
									saveConfig();
									onclickFun();
								},
							},
							React.createElement(DisplayIcon, { icon: Spicetify.SVGIcons.check, size: 16 })
						)
					)
				);
			}

			function dropDownItem({ name, field, options, onclickFun = () => {} }) {
				const [value, setValue] = useState(CONFIG[field]);
				return React.createElement(
					"div",
					{ className: "popup-row" },
					React.createElement("label", { className: "col description" }, name),
					React.createElement(
						"div",
						{ className: "col action" },
						React.createElement(
							"select",
							{
								value,
								onChange: (e) => {
									setValue(e.target.value);
									CONFIG[field] = e.target.value;
									saveConfig();
									onclickFun();
								},
							},
							Object.keys(options).map((item) =>
								React.createElement("option", { value: item }, options[item])
							)
						)
					)
				);
			}

			const settingsDOMContent = React.createElement(
				"div",
				null,
				style,
				React.createElement("div", { className: "popup-row" }, React.createElement("h3", { className: "div-title" }, "Artist Shuffle")),
				React.createElement("div", { className: "popup-row" }, React.createElement("hr", { className: "divider" }, null)),
				React.createElement(dropDownItem, {
					name: "Shuffle mode Artist Page",
					field: "artistMode",
					options: {
						all: "All",
						album: "Albums",
						single: "Singles & EP",
						likedSongArtist: "Artist's Liked Songs",
						topTen: "Top 10 Songs",
					},
				}),
				React.createElement(checkBoxItem, { name: "Chosen artist must be included", field: "artistNameMust" }),
				React.createElement(checkBoxItem, {
					name: "Enable Shuffle+ Queue Tracks button in Playbar",
					field: "enableQueueButton",
					onclickFun: () => renderQueuePlaybarButton(),
				})
			);

			Spicetify.PopupModal.display({ title: "Shuffle+", content: settingsDOMContent, isLarge: true });
		}

		const { Type } = Spicetify.URI;

		function shouldAddShufflePlus(uri) {
			if (uri.length === 1) {
				const uriObj = Spicetify.URI.fromString(uri[0]);
				switch (uriObj.type) {
					case Type.PLAYLIST:
					case Type.PLAYLIST_V2:
					case Type.ALBUM:
					case Type.ARTIST:
					case Type.COLLECTION:
					case Type.FOLDER:
					case Type.SHOW:
						return true;
				}
				return false;
			}
			return true;
		}

		function shouldAddShufflePlusLiked(uri) {
			const uriObj = Spicetify.URI.fromString(uri[0]);
			if (Spicetify.Platform.History.location.pathname === "/collection/tracks") {
				return uriObj.type === Type.TRACK;
			}
			return false;
		}

		function shouldAddShufflePlusLocal(uri) {
			const uriObj = Spicetify.URI.fromString(uri[0]);
			if (Spicetify.Platform.History.location.pathname === "/collection/local-files") {
				return uriObj.type === Type.TRACK || uriObj.type === Type.LOCAL_TRACK;
			}
			return false;
		}

		function renderQueuePlaybarButton() {
			if (!playbarButton) {
				playbarButton = new Spicetify.Playbar.Button(
					"Shuffle+ Queue Tracks",
					"enhance",
					async () => {
						await fetchAndPlay("queue");
					},
					false,
					false
				);
			}
			if (CONFIG.enableQueueButton) playbarButton.register();
			else playbarButton.deregister();
		}

		async function fetchPlaylistTracks(uri) {
			const res = await Spicetify.Platform.PlaylistAPI.getContents(`spotify:playlist:${uri}`, { limit: 9999999 });
			return res.items.filter((track) => track.isPlayable).map((track) => track.uri);
		}

		function searchFolder(rows, uri) {
			for (const r of rows) {
				if (r.type !== "folder" || !r.items) continue;
				if (r.uri === uri) return r;
				const found = searchFolder(r.items, uri);
				if (found) return found;
			}
		}

		async function fetchFolderTracks(uri) {
			const res = await Spicetify.Platform.RootlistAPI.getContents();
			const requestFolder = searchFolder(res.items, uri);
			if (!requestFolder) throw "Cannot find folder";

			const requestPlaylists = [];
			async function fetchNested(folder) {
				if (!folder.items) return;
				for (const i of folder.items) {
					if (i.type === "playlist") {
						const uriObj = Spicetify.URI.fromString(i.uri);
						const id = uriObj._base62Id ?? uriObj.id;
						requestPlaylists.push(await fetchPlaylistTracks(id));
					} else if (i.type === "folder") {
						await fetchNested(i);
					}
				}
			}
			await fetchNested(requestFolder);
			return requestPlaylists.flat();
		}

		async function fetchAlbumTracks(uri, includeMetadata = false) {
			const { queryAlbumTracks } = Spicetify.GraphQL.Definitions;
			const { data, errors } = await Spicetify.GraphQL.Request(queryAlbumTracks, { uri, offset: 0, limit: 100 });
			if (errors) throw errors[0].message;
			if (data.albumUnion.playability.playable === false) throw "Album is not playable";
			return (data.albumUnion?.tracksV2 ?? data.albumUnion?.tracks ?? []).items
				.filter(({ track }) => track.playability.playable)
				.map(({ track }) => (includeMetadata ? track : track.uri));
		}

		const artistFetchTypeCount = { album: 0, single: 0 };

		async function scanForTracksFromAlbums(res, artistName, type) {
			const allTracks = [];
			for (const album of res) {
				let albumRes;
				try {
					albumRes = await fetchAlbumTracks(album.uri, true);
				} catch (error) {
					console.error(album, error);
					continue;
				}
				artistFetchTypeCount[type]++;
				Spicetify.showNotification(`${artistFetchTypeCount[type]} / ${res.length} ${type}s`);
				for (const track of albumRes) {
					if (!CONFIG.artistNameMust || track.artists.items.some((artist) => artist.profile.name === artistName)) {
						allTracks.push(track.uri);
					}
				}
			}
			return allTracks;
		}

		// Fix #4: prefer the live persisted-query definitions Spicetify ships
		// with; only fall back to the hardcoded (build-pinned) hashes below,
		// and warn loudly so a stale hash is obvious instead of a silent
		// GraphQL failure.
		function getArtistOverviewQuery() {
			if (Spicetify.GraphQL.Definitions.queryArtistOverview) {
				return Spicetify.GraphQL.Definitions.queryArtistOverview;
			}
			console.warn("[Shuffle+] queryArtistOverview not found in Spicetify.GraphQL.Definitions, falling back to a pinned hash that may be stale on web.");
			return {
				name: "queryArtistOverview",
				operation: "query",
				sha256Hash: "35648a112beb1794e39ab931365f6ae4a8d45e65396d641eeda94e4003d41497",
				value: null,
			};
		}

		function getArtistDiscographyAllQuery() {
			if (Spicetify.GraphQL.Definitions.queryArtistDiscographyAll) {
				return Spicetify.GraphQL.Definitions.queryArtistDiscographyAll;
			}
			console.warn("[Shuffle+] queryArtistDiscographyAll not found in Spicetify.GraphQL.Definitions, falling back to a pinned hash that may be stale on web.");
			return {
				name: "queryArtistDiscographyAll",
				operation: "query",
				sha256Hash: "9380995a9d4663cbcb5113fef3c6aabf70ae6d407ba61793fd01e2a1dd6929b0",
				value: null,
			};
		}

		async function fetchArtistTracks(uri) {
			const discography = await Spicetify.GraphQL.Request(getArtistDiscographyAllQuery(), { uri, offset: 0, limit: 100 });
			if (discography.errors) throw discography.errors[0].message;

			const overview = await Spicetify.GraphQL.Request(getArtistOverviewQuery(), {
				uri,
				locale: Spicetify.Locale.getLocale(),
				includePrerelease: false,
			});
			if (overview.errors) throw overview.errors[0].message;

			const artistName = overview.data.artistUnion.profile.name;
			const releases = discography.data.artistUnion.discography.all.items.flatMap(({ releases }) => releases.items);
			const artistAlbums = releases.filter((album) => album.type === "ALBUM");
			const artistSingles = releases.filter((album) => album.type === "SINGLE" || album.type === "EP");
			if (artistAlbums.length === 0 && artistSingles.length === 0) throw "Artist has no releases";

			const allArtistAlbumsTracks = CONFIG.artistMode !== "single" ? await scanForTracksFromAlbums(artistAlbums, artistName, "album") : [];
			const allArtistSinglesTracks = CONFIG.artistMode !== "album" ? await scanForTracksFromAlbums(artistSingles, artistName, "single") : [];
			return allArtistAlbumsTracks.concat(allArtistSinglesTracks);
		}

		// Fix #5: guard on res.item existing before mapping.
		async function fetchArtistLikedTracks(uri) {
			const artistRes = await Spicetify.CosmosAsync.get(`sp://core-collection/unstable/@/list/tracks/artist/${uri}?responseFormat=protobufJson`);
			if (!artistRes?.item) return [];
			return artistRes.item
				.filter((artistTrack) => artistTrack?.trackMetadata?.playable)
				.map((artistTrack) => artistTrack.trackMetadata.link);
		}

		async function fetchArtistTopTenTracks(uri) {
			const { queryArtistOverview } = Spicetify.GraphQL.Definitions;
			const { data, errors } = await Spicetify.GraphQL.Request(queryArtistOverview ?? getArtistOverviewQuery(), {
				uri,
				locale: Spicetify.Locale.getLocale(),
				includePrerelease: false,
			});
			if (errors) throw errors[0].message;
			return data.artistUnion.discography.topTracks.items.map(({ track }) => track.uri);
		}

		async function fetchLikedTracks() {
			const res = await Spicetify.Platform.LibraryAPI.getTracks({ limit: 9999999 });
			return res.items.filter((track) => track.isPlayable).map((track) => track.uri);
		}

		async function fetchLocalTracks() {
			const res = await Spicetify.Platform.LocalFilesAPI.getTracks();
			return res.map((track) => track.uri);
		}

		function fetchQueue() {
			const { _queueState } = Spicetify.Platform.PlayerAPI._queue;
			const nextUp = _queueState.nextUp.map((track) => track.uri);
			const queued = _queueState.queued.map((track) => track.uri);
			const array = [...new Set([...nextUp, ...queued])];
			const current = _queueState.current?.uri;
			if (current) array.push(current);
			return array;
		}

		async function fetchCollection(uriObj) {
			const { category, type } = uriObj;
			const { pathname } = Spicetify.Platform.History.location;
			switch (type) {
				case Type.TRACK:
				case Type.LOCAL_TRACK:
					switch (pathname) {
						case "/collection/tracks":
							return await fetchLikedTracks();
						case "/collection/local-files":
							return await fetchLocalTracks();
					}
					break;
				case Type.COLLECTION:
					switch (category) {
						case "tracks":
							return await fetchLikedTracks();
						case "local-files":
							return await fetchLocalTracks();
					}
			}
		}

		// Fix #5: guard on res.items existing before mapping.
		async function fetchShows(uri) {
			const res = await Spicetify.CosmosAsync.get(`sp://core-show/v1/shows/${uri}?responseFormat=protobufJson`);
			if (!res?.items) return [];
			return res.items.filter((track) => track.episodePlayState.isPlayable).map((track) => track.episodeMetadata.link);
		}

		function shuffle(array) {
			let counter = array.length;
			if (counter <= 1) return array;
			while (counter > 0) {
				const index = Math.floor(Math.random() * counter);
				counter--;
				const temp = array[counter];
				array[counter] = array[index];
				array[index] = temp;
			}
			return array.filter(Boolean);
		}

		async function Queue(list, context, type) {
			const count = list.length;
			list.push("spotify:delimiter");
			const { _queue, _client } = Spicetify.Platform.PlayerAPI._queue;
			const { prevTracks, queueRevision } = _queue;

			const nextTracks = list.map((uri) => ({
				contextTrack: { uri, uid: "", metadata: { is_queued: "false" } },
				removed: [],
				blocked: [],
				provider: "context",
			}));

			_client.setQueue({ nextTracks, prevTracks, queueRevision });

			if (context) {
				const { sessionId } = Spicetify.Platform.PlayerAPI.getState();
				Spicetify.Platform.PlayerAPI.updateContext(sessionId, { uri: context, url: `context://${context}` });
			}

			Spicetify.Player.next();

			switch (type) {
				case Type.ARTIST:
					if (CONFIG.artistMode === "topTen") {
						Spicetify.showNotification(`Shuffled Top ${count} Songs`);
						break;
					}
					if (CONFIG.artistMode === "likedSongArtist") {
						Spicetify.showNotification(`Shuffled ${count} Liked Songs`);
						break;
					}
					if (CONFIG.artistMode === "single") {
						Spicetify.showNotification(`Shuffled ${artistFetchTypeCount.single} Singles, Total of ${count} Songs`);
						break;
					}
					if (CONFIG.artistMode === "album") {
						Spicetify.showNotification(`Shuffled ${artistFetchTypeCount.album} Albums, Total of ${count} Songs`);
						break;
					}
					Spicetify.showNotification(`Shuffled ${artistFetchTypeCount.album} Albums, ${artistFetchTypeCount.single} Singles, Total of ${count} Songs`);
					break;
				default:
					Spicetify.showNotification(`Shuffled ${count} Songs`);
			}

			artistFetchTypeCount.album = 0;
			artistFetchTypeCount.single = 0;
		}

		async function fetchAndPlay(rawUri) {
			let list;
			let context;
			let type = null;

			try {
				if (rawUri === "queue") {
					list = fetchQueue();
					context = null;
				} else if (typeof rawUri === "object") {
					list = rawUri;
					context = null;
				} else {
					const uriObj = Spicetify.URI.fromString(rawUri);
					type = uriObj.type;
					const uri = uriObj._base62Id ?? uriObj.id;

					switch (type) {
						case Type.PLAYLIST:
						case Type.PLAYLIST_V2:
							list = await fetchPlaylistTracks(uri);
							break;
						case Type.ALBUM:
							list = await fetchAlbumTracks(rawUri);
							break;
						case Type.ARTIST: // Fix #3: plain constant, not a template-literal no-op
							if (CONFIG.artistMode === "likedSongArtist") {
								list = await fetchArtistLikedTracks(uri);
								break;
							}
							if (CONFIG.artistMode === "topTen") {
								list = await fetchArtistTopTenTracks(rawUri);
								break;
							}
							list = await fetchArtistTracks(rawUri);
							break;
						case Type.TRACK:
						case Type.LOCAL_TRACK:
						case Type.COLLECTION:
							list = await fetchCollection(uriObj);
							break;
						case Type.FOLDER:
							list = await fetchFolderTracks(rawUri);
							break;
						case Type.SHOW:
							list = await fetchShows(uri);
							break;
					}

					if (!list?.length) {
						Spicetify.showNotification("Nothing to play", true);
						return;
					}

					context = rawUri;
					// Fix #2: compare against the real Type constants, not the
					// string literals "folder"/"collection"/"local" which never
					// matched Spicetify.URI.Type.FOLDER/COLLECTION/LOCAL_TRACK.
					if (type === Type.FOLDER || type === Type.COLLECTION || type === Type.LOCAL_TRACK) {
						context = null;
					}
				}

				await Queue(shuffle(list), context, type);
			} catch (error) {
				Spicetify.showNotification(String(error), true);
				console.error(error);
			}
		}

		function init() {
			new Spicetify.Menu.Item("Shuffle+", false, settingsPage, "shuffle").register();

			new Spicetify.ContextMenu.Item(
				"Play with Shuffle+",
				async (uri) => {
					if (uri.length === 1) {
						await fetchAndPlay(uri[0]);
						return;
					}
					await fetchAndPlay(uri);
				},
				shouldAddShufflePlus,
				"shuffle"
			).register();

			new Spicetify.ContextMenu.Item(
				"Shuffle+ Liked Songs",
				async (uri) => {
					await fetchAndPlay(uri[0]);
				},
				shouldAddShufflePlusLiked,
				"heart-active"
			).register();

			new Spicetify.ContextMenu.Item(
				"Shuffle+ Local Files",
				async (uri) => {
					await fetchAndPlay(uri[0]);
				},
				shouldAddShufflePlusLocal,
				"playlist-folder"
			).register();

			renderQueuePlaybarButton();
		}

		init();
	}

	shufflePlus();
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);
