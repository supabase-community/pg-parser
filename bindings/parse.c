#include "pg_query.h"
#include "macros.h"

EXPORT("parse_sql")
char *parse_sql(char *sql)
{
  PgQueryParseResult result = pg_query_parse(sql);
  return result.parse_tree;
}

EXPORT("free_parse_result")
void free_parse_result(PgQueryParseResult result)
{
  pg_query_free_parse_result(result);
}