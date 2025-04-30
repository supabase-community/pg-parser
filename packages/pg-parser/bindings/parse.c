#include <stdlib.h>
#include "pg_query.h"
#include "macros.h"

EXPORT("parse_sql")
PgQueryProtobufParseResult *parse_sql(char *sql)
{
  PgQueryProtobufParseResult *result = (PgQueryProtobufParseResult *)malloc(sizeof(PgQueryProtobufParseResult));
  *result = pg_query_parse_protobuf(sql);
  return result;
}

EXPORT("free_parse_result")
void free_parse_result(PgQueryProtobufParseResult *result)
{
  pg_query_free_protobuf_parse_result(*result);
  free(result);
}