FROM mcr.microsoft.com/windows/nanoserver:1809 AS data
RUN mkdir app
WORKDIR app
RUN time /T > now1.txt
RUN time /T > now2.txt
RUN time /T > now3.txt
RUN time /T > now4.txt
RUN time /T > now5.txt
RUN time /T > now6.txt
RUN time /T > now7.txt
RUN time /T > now8.txt
RUN time /T > now9.txt
RUN time /T > now10.txt
RUN time /T > now11.txt
RUN time /T > now12.txt
RUN time /T > now13.txt
RUN time /T > now14.txt
RUN time /T > now15.txt
RUN time /T > now16.txt

FROM scratch
RUN mkdir app
WORKDIR app
COPY --from=data app/now16.txt data_stage_built_at.txt
