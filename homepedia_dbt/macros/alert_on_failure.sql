-- Macro DBT : génère un résumé des tests échoués
-- Appelée dans on-run-end pour logger les erreurs
{% macro alert_on_failure(results) %}
  {% set failures = [] %}
  {% for result in results %}
    {% if result.status == 'fail' or result.status == 'error' %}
      {% do failures.append(result.node.name ~ ': ' ~ result.status) %}
    {% endif %}
  {% endfor %}

  {% if failures | length > 0 %}
    {{ log("ALERTES DBT : " ~ failures | join(', '), info=True) }}
  {% else %}
    {{ log("✅ Tous les tests DBT ont passé", info=True) }}
  {% endif %}
{% endmacro %}
