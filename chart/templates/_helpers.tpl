{{/*
Expand the name of the chart.
*/}}
{{- define "mpchess.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "mpchess.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "mpchess.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "mpchess.labels" -}}
helm.sh/chart: {{ include "mpchess.chart" . }}
{{ include "mpchess.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "mpchess.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mpchess.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Port name — "http" by default, "https" when TLS is enabled.
Used for container port name, service port name, and probe port.
*/}}
{{- define "mpchess.portName" -}}
{{- if .Values.tls.enabled -}}
https
{{- else -}}
http
{{- end -}}
{{- end -}}

{{/*
Effective path prefix for Gateway/Ingress routing.
Defaults to server.prefix if set, otherwise "/" (root).
Normalizes the value the same way server.js does:
  - empty or "/" → "/"
  - otherwise: one leading slash, no trailing slashes
This way the user only needs to set server.prefix in one place.
*/}}
{{- define "mpchess.pathPrefix" -}}
{{- $raw := default "/" .Values.server.prefix -}}
{{- $stripped := regexReplaceAll "^/+|/+$" $raw "" -}}
{{- if $stripped -}}
/{{ $stripped }}
{{- else -}}
/
{{- end -}}
{{- end -}}
