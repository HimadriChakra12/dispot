#define OUTFILE "dist/dispot.user.js"
#include "build.h"

#define NAME        "dispot"
#define NAMESPACE   "https://github.com/HimadriChakra12/dispot"
#define DESCRIPTION "A spicetify alike userscript for better spotify experience"

listout(MATCH,
    "https://open.spotify.com/*",
    );

listout(GRANT,
    "unsafeWindow",
    );

static const build_tag_t EXTRA[1];
enum { EXTRA_COUNT = 0 };

listout(ORDER,
    "src/start.js",
    "src/shim.js",
    "src/theme/theme-dom-patch.js",
    "src/ext/ext-autoskip-explicit.js",
    "src/ext/ext-autoskip-video.js",
    "src/ext/ext-trashbin.js",
    "src/ext/ext-loopyloop.js",
    "src/ext/ext-keyboard-shortcut.js",
    "src/ext/ext-adblock.js",
    "src/ext/ext-shuffle-mode.js",
    "src/end.js",
    );

declaremeta(META,
    .name = NAME,
    .namespace_ = NAMESPACE,
    .description = DESCRIPTION,
    .match = MATCH, .match_count = MATCH_COUNT,
    .grant = GRANT, .grant_count = GRANT_COUNT,
    .run_at = "document-idle",
    .extra = EXTRA, .extra_count = EXTRA_COUNT,
);

int main(void) {
    build_t b;
    build_init(&b, NULL, "__SPICETIFY_WEB_VERSION__");
    build_userscript_header(&b, &META);
    build_add_all(&b, ORDER, ORDER_COUNT, "src/");
    build_finish(&b, NULL);
    return 0;
}
