FROM mcr.microsoft.com/windows/nanoserver:1809 AS data
RUN mkdir app
WORKDIR app
RUN time /T > now1.txt
RUN time /T > now2.txt
RUN time /T > now3.txt

FROM mcr.microsoft.com/windows/nanoserver:1809
RUN mkdir app
WORKDIR app
COPY --from=data app/now3.txt data_stage_built_at.txt
