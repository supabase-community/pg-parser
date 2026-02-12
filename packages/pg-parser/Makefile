AUTOCONF = autoconf
AUTOMAKE = automake
ACLOCAL = aclocal
AUTORECONF = autoreconf
AUTORECONF_FLAGS = -fiv

PROTOBUF_TYPE_GENERATOR = tsx scripts/generate-types.ts

SRC_DIR = bindings
OUTPUT_DIR = wasm/$(LIBPG_QUERY_VERSION)
OUTPUT_JS = $(OUTPUT_DIR)/pg-parser.js
OUTPUT_WASM = $(OUTPUT_DIR)/pg-parser.wasm
OUTPUT_D_TS = pg-parser.d.ts
OUTPUT_FILES = $(OUTPUT_JS) $(OUTPUT_WASM) $(OUTPUT_D_TS)
WASM_MODULE_NAME := PgParserModule

include $(SRC_DIR)/Filelists.mk
OBJ_FILES = $(SRC_FILES:.c=.o)
INCLUDE = $(SRC_DIR)/include

RELEASE ?= 0

CFLAGS = -Oz -Wall -std=c11
LDFLAGS = -Wl,--gc-sections,--strip-all

EMSCRIPTEN_FLAGS = \
		--no-entry \
		-sALLOW_MEMORY_GROWTH=1 \
		-sEXPORT_NAME="$(WASM_MODULE_NAME)" \
		-sEXPORTED_RUNTIME_METHODS="['HEAP8','getValue']" \
		-sEXPORTED_FUNCTIONS="['_malloc', '_free']" \
		-sMODULARIZE=1 \
		-sEXPORT_ES6=1

VENDOR_DIR = vendor

LIBPG_QUERY_REPO = https://github.com/pganalyze/libpg_query.git
LIBPG_QUERY_TAG ?= 17-6.1.0
LIBPG_QUERY_DIR = $(VENDOR_DIR)/libpg_query/$(LIBPG_QUERY_TAG)
LIBPG_QUERY_SRC_DIR = $(LIBPG_QUERY_DIR)/src
LIBPG_QUERY_LIB = $(LIBPG_QUERY_DIR)/libpg_query.a
LIBPG_QUERY_STAMP = $(LIBPG_QUERY_DIR)/.stamp
LIBPG_QUERY_VERSION := $(firstword $(subst -, ,$(LIBPG_QUERY_TAG)))
LIBPG_QUERY_PROTOBUF_DIR = $(LIBPG_QUERY_DIR)/protobuf
LIBPG_QUERY_PROTOBUF_C_DIR = $(LIBPG_QUERY_DIR)/vendor/protobuf-c
LIBPG_QUERY_PROTOBUF_C_SRC_FILES = $(wildcard $(LIBPG_QUERY_PROTOBUF_C_DIR)/*.c)
LIBPG_QUERY_PROTOBUF_C_OBJ_FILES = $(LIBPG_QUERY_PROTOBUF_C_SRC_FILES:.c=.o)

JANSSON_REPO = https://github.com/akheron/jansson.git
JANSSON_TAG = v2.14.1
JANSSON_DIR = $(VENDOR_DIR)/jansson/$(JANSSON_TAG)
JANSSON_SRC_DIR = $(JANSSON_DIR)/src
JANSSON_LIB = $(JANSSON_SRC_DIR)/.libs/libjansson.a
JANSSON_STAMP = $(JANSSON_DIR)/.stamp

.DEFAULT_GOAL := build

$(OUTPUT_FILES): $(OBJ_FILES) $(LIBPG_QUERY_LIB) $(JANSSON_LIB)
	@mkdir -p $(OUTPUT_DIR)
	$(CC) $(LDFLAGS) $(EMSCRIPTEN_FLAGS) -o $(OUTPUT_JS) $(OBJ_FILES) $(LIBPG_QUERY_LIB) $(JANSSON_LIB) $(if $(filter 1,$(RELEASE)),--closure 1) --emit-tsd $(OUTPUT_D_TS)
	@# Patch Emscripten glue code for bundler compatibility (webpack/turbopack).
	@# 1. import("module") — bundlers can't resolve this Node.js builtin in browser bundles.
	@# 2. new URL(".", import.meta.url) — bundlers trace the assigned variable back to
	@#    import.meta.url and flag any new URL() using it as an asset import. .slice()
	@#    breaks the trace while returning an identical string value.
	sed -i 's/await import("module")/await import(\/* webpackIgnore: true *\/ "module")/' $(OUTPUT_JS)
	sed -i 's/= import\.meta\.url/= import.meta.url.slice()/' $(OUTPUT_JS)
	$(PROTOBUF_TYPE_GENERATOR) -i $(LIBPG_QUERY_DIR)/protobuf/pg_query.proto -o $(OUTPUT_DIR)

$(OBJ_FILES): %.o: %.c | $(LIBPG_QUERY_LIB) $(JANSSON_LIB)
	$(CC) -I$(LIBPG_QUERY_DIR) -I$(LIBPG_QUERY_DIR)/vendor -I$(JANSSON_SRC_DIR) -I$(INCLUDE) $(CFLAGS) -c $< -o $@

$(LIBPG_QUERY_LIB): $(LIBPG_QUERY_STAMP)
	$(MAKE) -C $(LIBPG_QUERY_DIR) build

$(JANSSON_LIB): $(JANSSON_STAMP)
	cd $(JANSSON_DIR) && \
	$(AUTORECONF) -i && \
	emconfigure ./configure --host=wasm32 && \
	$(MAKE)

$(LIBPG_QUERY_STAMP):
	git clone -c advice.detachedHead=false --depth 1 --branch $(LIBPG_QUERY_TAG) $(LIBPG_QUERY_REPO) $(LIBPG_QUERY_DIR)
	@# Patch protoc to emit json_name descriptors (required by our protobuf<->JSON bridge).
	@# Our forked protobuf-c supports --c_out=json_name=true: to populate json_name in field descriptors.
	sed -i 's|--c_out=\.|--c_out=json_name=true:.|' $(LIBPG_QUERY_DIR)/Makefile
	@# Force protobuf regeneration so .pb-c.c/.h get json_name descriptors
	touch $(LIBPG_QUERY_DIR)/protobuf/pg_query.proto
	@# --- Per-node deparse support ---
	@# Append deparseNode() to postgres_deparse.c (version-specific patch because
	@# deparseExpr signature changed in PG17 and PG17 added JSON expression types).
	@# These patches only append new functions — they never modify existing code.
	@# The only maintenance trigger is bumping LIBPG_QUERY_TAG to a new PG version.
ifeq ($(LIBPG_QUERY_VERSION),17)
	cat $(SRC_DIR)/patches/deparse_node_17.c >> $(LIBPG_QUERY_SRC_DIR)/postgres_deparse.c
else
	cat $(SRC_DIR)/patches/deparse_node_15_16.c >> $(LIBPG_QUERY_SRC_DIR)/postgres_deparse.c
endif
	@# Append pg_query_deparse_node_protobuf() entry point
	cat $(SRC_DIR)/patches/deparse_node_entry.c >> $(LIBPG_QUERY_SRC_DIR)/pg_query_deparse.c
	@# Append pg_query_protobuf_to_node() (public wrapper around static _readNode)
	cat $(SRC_DIR)/patches/read_node_public.c >> $(LIBPG_QUERY_SRC_DIR)/pg_query_readfuncs_protobuf.c
	@# Add declarations to headers
	sed -i '/extern void deparseRawStmt/i\extern void deparseNode(StringInfo str, Node *node);' $(LIBPG_QUERY_SRC_DIR)/postgres_deparse.h
	sed -i '/List \* pg_query_protobuf_to_nodes/a\Node * pg_query_protobuf_to_node(PgQueryProtobuf protobuf);' $(LIBPG_QUERY_SRC_DIR)/pg_query_readfuncs.h
	echo 'PgQueryDeparseResult pg_query_deparse_node_protobuf(PgQueryProtobuf node_protobuf);' >> $(LIBPG_QUERY_DIR)/pg_query.h
	touch $@

$(JANSSON_STAMP):
	git clone -c advice.detachedHead=false --depth 1 --branch $(JANSSON_TAG) $(JANSSON_REPO) $(JANSSON_DIR)
	touch $@

build: $(OUTPUT_FILES)

clean:
	rm -rf $(OUTPUT_DIR)
	rm $(OBJ_FILES)

clean-vendor:
	rm -rf $(VENDOR_DIR)

clean-all: clean clean-vendor

.PHONY: build clean clean-vendor clean-all
.SUFFIXES: