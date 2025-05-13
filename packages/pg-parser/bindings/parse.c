#include <stdio.h>
#include <stdlib.h>

#include "macros.h"
#include "pg_query.h"

EXPORT("parse_sql")
PgQueryProtobufParseResult *parse_sql(char *sql) {
  PgQueryProtobufParseResult *result = (PgQueryProtobufParseResult *)malloc(sizeof(PgQueryProtobufParseResult));
  *result = pg_query_parse_protobuf(sql);
  return result;
}

EXPORT("deparse_sql")
PgQueryDeparseResult *deparse_sql(PgQueryProtobuf *parse_tree) {
  PgQueryDeparseResult *result = (PgQueryDeparseResult *)malloc(sizeof(PgQueryDeparseResult));
  printf("Deparse parse tree: %p\n", parse_tree);
  printf("Deparse parse tree length: %d\n", parse_tree->len);
  *result = pg_query_deparse_protobuf(*parse_tree);
  printf("Deparse error: %p\n", result->error);
  printf("Deparse result: %s\n", result->query);
  return result;
}

EXPORT("free_parse_result")
void free_parse_result(PgQueryProtobufParseResult *result) {
  pg_query_free_protobuf_parse_result(*result);
  free(result);
}

EXPORT("free_deparse_result")
void free_deparse_result(PgQueryDeparseResult *result) {
  pg_query_free_deparse_result(*result);
  free(result);
}