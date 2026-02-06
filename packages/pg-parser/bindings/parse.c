#include <stdlib.h>
#include <string.h>

#include "macros.h"
#include "pg_query.h"
#include "protobuf-json.h"

// Forward-declare from pg_query.c (not in public header).
// Used to avoid linking pg_query_parse.c which pulls in the old JSON serializer.
void pg_query_free_error(PgQueryError *error);

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
    free(protobufResult);
    return result;
  }

  ProtobufToJsonResult *json_result = protobuf_to_json(&protobufResult->parse_tree);
  free(protobufResult->parse_tree.data);

  if (json_result->json_string == NULL) {
    PgQueryError *error = NULL;
    if (json_result->error) {
      error = (PgQueryError *)calloc(1, sizeof(PgQueryError));
      error->message = json_result->error; // Transfer ownership of string
    }
    result->parse_tree = NULL;
    result->error = error;
    result->stderr_buffer = protobufResult->stderr_buffer;
    free(json_result); // Don't free ->error, ownership transferred
    free(protobufResult);
    return result;
  }

  result->parse_tree = json_result->json_string;
  result->error = NULL;
  result->stderr_buffer = protobufResult->stderr_buffer;
  free(json_result);
  free(protobufResult);
  return result;
}

EXPORT("deparse_sql")
PgQueryDeparseResult *deparse_sql(char *parse_tree_json) {
  JsonToProtobufResult *protobuf_result = json_to_protobuf(parse_tree_json);

  if (protobuf_result->error) {
    PgQueryDeparseResult *result = (PgQueryDeparseResult *)malloc(sizeof(PgQueryDeparseResult));
    PgQueryError *error = (PgQueryError *)calloc(1, sizeof(PgQueryError));
    error->message = protobuf_result->error; // Transfer ownership of string
    result->query = NULL;
    result->error = error;
    free(protobuf_result); // Don't free ->error, ownership transferred
    return result;
  }

  PgQueryDeparseResult *result = (PgQueryDeparseResult *)malloc(sizeof(PgQueryDeparseResult));
  *result = pg_query_deparse_protobuf(protobuf_result->protobuf);

  free(protobuf_result->protobuf.data);
  free(protobuf_result);
  return result;
}

EXPORT("free_parse_result")
void free_parse_result(PgQueryParseResult *result) {
  // Manually free instead of calling pg_query_free_parse_result(),
  // which lives in pg_query_parse.c and transitively pulls in the
  // old hand-rolled JSON serializer (~100-125 KB).
  if (result->error) {
    pg_query_free_error(result->error);
  }
  free(result->parse_tree);
  free(result->stderr_buffer);
  free(result);
}

EXPORT("free_deparse_result")
void free_deparse_result(PgQueryDeparseResult *result) {
  pg_query_free_deparse_result(*result);
  free(result);
}
