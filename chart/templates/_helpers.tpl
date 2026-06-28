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
Server CLI args from values — one per line for YAML list
*/}}
{{- define "mpchess.serverArgs" -}}
- --port={{ .Values.server.port }}
{{- if .Values.server.fen }}
- --fen={{ .Values.server.fen }}
{{- end }}
{{- if .Values.server.allowedOrigins }}
- --allowed-origins={{ .Values.server.allowedOrigins }}
{{- end }}
{{- if .Values.tls.enabled }}
- --cert=/etc/tls/tls.crt
- --key=/etc/tls/tls.key
{{- end }}
{{- end }}
