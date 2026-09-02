#define OUTFILE "" //OUTPUT
#include "build.h"

#define NAME        ""
#define NAMESPACE   ""
#define DESCRIPTION ""

listout(MATCH,
    "",
    );

listout(GRANT,
    "unsafeWindow",
    "GM_download"
    );

/* Custom @tag lines that don't have a fixed build_meta_t field. */
listtags(EXTRA,
    { "//NAME", "//Description" },
    );

listout(ORDER,
    "src/start.js",
    "src/end.js",
    );

declaremeta(META,
    .name = NAME,
    .namespace_ = NAMESPACE,
    .description = DESCRIPTION,
    .match = MATCH, .match_count = MATCH_COUNT,
    .grant = GRANT, .grant_count = GRANT_COUNT,
    .run_at = "document-start",
    .extra = EXTRA, .extra_count = EXTRA_COUNT,
);

int main(void) {
    build_t b;
    build_init(&b, NULL, "__HLS_SAVER_VERSION__"); 
    build_userscript_header(&b, &META);
    build_add_all(&b, ORDER, ORDER_COUNT, "src/");
    build_finish(&b, NULL); 
    return 0;
}
