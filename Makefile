PROTOBUF_TYPE_GENERATOR = tsx scripts/generate-types.ts

SRC_DIR = bindings
OUTPUT_DIR = wasm/$(LIBPG_QUERY_VERSION)
OUTPUT_JS = $(OUTPUT_DIR)/pg-parser.js
OUTPUT_WASM = $(OUTPUT_DIR)/pg-parser.wasm
OUTPUT_D_TS = pg-parser.d.ts
WASM_MODULE_NAME := PgParserModule

include $(SRC_DIR)/Filelists.mk
OBJ_FILES = $(SRC_FILES:.c=.o)
INCLUDE = $(SRC_DIR)/include

CFLAGS = -Oz -Wall -std=c11
LDFLAGS = -Wl,--gc-sections,--strip-all \
		--no-entry \
		-sFILESYSTEM=0 \
		-sEXPORT_NAME="$(WASM_MODULE_NAME)" \
		-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,getValue,UTF8ToString \
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

.DEFAULT_GOAL := build

$(OUTPUT_JS): $(OBJ_FILES) $(LIBPG_QUERY_LIB)
	@mkdir -p $(OUTPUT_DIR)
	$(CC) $(LDFLAGS) -L$(LIBPG_QUERY_DIR) -lpg_query -o $(OUTPUT_JS) $(OBJ_FILES) --closure 0 --emit-tsd $(OUTPUT_D_TS)
	$(PROTOBUF_TYPE_GENERATOR) -i $(LIBPG_QUERY_DIR)/protobuf/pg_query.proto -o $(OUTPUT_DIR)

%.o: %.c | $(LIBPG_QUERY_LIB)
	$(CC) -I$(LIBPG_QUERY_DIR) -I$(INCLUDE) $(CFLAGS) -c $< -o $@

$(LIBPG_QUERY_LIB): $(LIBPG_QUERY_STAMP)
	$(MAKE) -C $(LIBPG_QUERY_DIR) build

$(LIBPG_QUERY_STAMP):
	git clone --depth 1 --branch $(LIBPG_QUERY_TAG) $(LIBPG_QUERY_REPO) $(LIBPG_QUERY_DIR)
	touch $@

build: $(OUTPUT_JS)

clean:
	rm -rf $(OUTPUT_DIR)
	rm $(OBJ_FILES)

clean-vendor:
	rm -rf $(VENDOR_DIR)

clean-all: clean clean-vendor

.PHONY: build clean clean-vendor clean-all
.SUFFIXES: