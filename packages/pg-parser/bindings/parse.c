#include <stdio.h>
#include <stdlib.h>

#include "macros.h"
#include "pg_query.h"
#include "protobuf-json.h"

EXPORT("parse_sql")
PgQueryParseResult *parse_sql(char *sql) {
  PgQueryProtobufParseResult *protobufResult = (PgQueryProtobufParseResult *)malloc(sizeof(PgQueryProtobufParseResult));
  *protobufResult = pg_query_parse_protobuf(sql);

  PgQueryParseResult *result = (PgQueryParseResult *)malloc(sizeof(PgQueryParseResult));

  if (protobufResult->error) {
    free(protobufResult->parse_tree.data);
    result->parse_tree = NULL;
    result->error = protobufResult->error;
    result->stderr_buffer = protobufResult->stderr_buffer;
    return result;
  }

  ProtobufToJsonResult *json_result = protobuf_to_json(&protobufResult->parse_tree);
  free(protobufResult->parse_tree.data);

  if (json_result->json_string == NULL) {
    free(json_result->error);
    free(json_result);
    // TODO: return the json error
    return NULL;
  }

  result->parse_tree = json_result->json_string;
  result->error = NULL;
  result->stderr_buffer = protobufResult->stderr_buffer;
  return result;
}

EXPORT("deparse_sql")
PgQueryDeparseResult *deparse_sql(char *parse_tree_json) {
  JsonToProtobufResult *protobuf_result = json_to_protobuf(parse_tree_json);

  if (protobuf_result->error) {
    free(protobuf_result->error);
    free(protobuf_result);
    // TODO: return the protobuf error
    return NULL;
  }

  PgQueryDeparseResult *result = (PgQueryDeparseResult *)malloc(sizeof(PgQueryDeparseResult));
  printf("Deparse parse tree: %p\n", parse_tree_json);
  printf("Deparse parse tree length: %d\n", protobuf_result->protobuf.len);
  *result = pg_query_deparse_protobuf(protobuf_result->protobuf);
  printf("Deparse error: %p\n", result->error);
  printf("Deparse result: %s\n", result->query);

  return result;
}

EXPORT("free_parse_result")
void free_parse_result(PgQueryParseResult *result) {
  pg_query_free_parse_result(*result);
  free(result);
}

EXPORT("free_deparse_result")
void free_deparse_result(PgQueryDeparseResult *result) {
  pg_query_free_deparse_result(*result);
  free(result);
}